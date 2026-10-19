const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { getAuth } = require('firebase-admin/auth');
initializeApp();
const db = getDatabase();

function uidOf(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Please sign in first.');
  return req.auth.uid;
}
function adminOf(req) {
  const uid = uidOf(req);
  if (req.auth.token.admin !== true) throw new HttpsError('permission-denied', 'Admin access required.');
  return uid;
}
function str(v, max=120) {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > max) throw new HttpsError('invalid-argument', 'Invalid text value.');
  return v.trim();
}
function int(v, min=1, max=5000) {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new HttpsError('invalid-argument', `Amount must be ${min}–${max}.`);
  return n;
}

// Creates a request only. Credits are never added until an admin verifies payment.
exports.submitTopup = onCall(async req => {
  const uid = uidOf(req);
  const amount = int(req.data?.amount, 150, 5000);
  const utr = str(String(req.data?.utr || ''), 40);
  if (!/^[0-9]{6,30}$/.test(utr)) throw new HttpsError('invalid-argument', 'UTR must contain 6–30 digits.');
  const paymentApp = str(req.data?.paymentApp, 30);
  if (!['GPay','PhonePe','Paytm','Navi','Other'].includes(paymentApp)) throw new HttpsError('invalid-argument', 'Unsupported payment app.');
  const screenshotUrl = str(req.data?.screenshotUrl, 1000);
  let screenshotPath = '';
  try { const parsed = new URL(screenshotUrl); screenshotPath = decodeURIComponent(parsed.pathname); if (parsed.protocol !== 'https:' || parsed.hostname !== 'firebasestorage.googleapis.com' || !screenshotPath.includes(`/o/payment-screenshots/${uid}/`)) throw new Error('bad path'); } catch (_) { throw new HttpsError('invalid-argument', 'Screenshot must be a Firebase Storage file uploaded to your own payment-screenshots folder.'); }
  const utrRef = db.ref(`utrIndex/${utr}`);
  const lock = await utrRef.transaction(v => v === null ? {uid, createdAt: Date.now()} : undefined);
  if (!lock.committed) throw new HttpsError('already-exists', 'This UTR has already been submitted.');
  const ref = db.ref('topupRequests').push();
  const now = Date.now();
  try {
    await ref.set({uid, amount, utr, paymentApp, screenshotUrl, status:'Pending', createdAt:now});
    const updates = {};
    updates[`users/${uid}/paymentRequests/${ref.key}`] = {requestId:ref.key, amount, status:'Pending', createdAt:now};
    updates[`users/${uid}/transactions/${ref.key}`] = {type:'topup_request', amount, status:'Pending', createdAt:now};
    await db.ref().update(updates);
  } catch (e) {
    await utrRef.remove(); await ref.remove();
    throw new HttpsError('internal', 'Could not save request. Please retry.');
  }
  return {requestId:ref.key, status:'Pending'};
});

// Admin must verify the payment in the payment provider before approving.
// Processing state + an idempotency marker on the user record prevents double credit
// if a function retries after the balance was changed but before the request status saved.
exports.reviewTopup = onCall(async req => {
  const adminUid = adminOf(req);
  const id = str(req.data?.requestId, 100);
  const decision = req.data?.decision;
  if (!['approve','reject'].includes(decision)) throw new HttpsError('invalid-argument', 'Decision must be approve or reject.');
  const ref = db.ref(`topupRequests/${id}`);
  let snap = await ref.get();
  if (!snap.exists()) throw new HttpsError('not-found', 'Request not found.');
  let row = snap.val();
  const processing = `Processing:${decision}`;
  if (row.status === 'Pending') {
    const claim = await ref.child('status').transaction(v => v === 'Pending' ? processing : undefined);
    if (!claim.committed) {
      snap = await ref.get(); row = snap.val() || {};
      if (row.status !== processing) throw new HttpsError('failed-precondition', 'This payment was already reviewed or is being reviewed with a different decision.');
    }
  } else if (row.status !== processing) {
    throw new HttpsError('failed-precondition', 'Already reviewed.');
  }

  const now = Date.now();
  if (decision === 'approve') {
    const userRef = db.ref(`users/${row.uid}`);
    const result = await userRef.transaction(user => {
      user = user && typeof user === 'object' ? user : {};
      const processed = user.processedTopups && typeof user.processedTopups === 'object' ? user.processedTopups : {};
      if (processed[id] === true) return user; // idempotent retry; never credit twice
      const current = Number.isSafeInteger(user.creditBalance) && user.creditBalance >= 0 ? user.creditBalance : 0;
      user.creditBalance = current + Number(row.amount);
      user.processedTopups = {...processed, [id]: true};
      user.paymentRequests = user.paymentRequests && typeof user.paymentRequests === 'object' ? user.paymentRequests : {};
      user.paymentRequests[id] = {...(user.paymentRequests[id] || {}), requestId:id, amount:row.amount, status:'Approved', createdAt:row.createdAt, reviewedAt:now};
      user.transactions = user.transactions && typeof user.transactions === 'object' ? user.transactions : {};
      user.transactions[id] = {...(user.transactions[id] || {}), type:'topup_approved', amount:row.amount, status:'Approved', balanceChange:row.amount, createdAt:row.createdAt, reviewedAt:now};
      return user;
    });
    if (!result.committed) throw new HttpsError('internal', 'Credit update did not commit. Retry the same approval to safely resume.');
  }
  const status = decision === 'approve' ? 'Approved' : 'Rejected';
  const updates = {};
  updates[`topupRequests/${id}/status`] = status;
  updates[`topupRequests/${id}/reviewedBy`] = adminUid;
  updates[`topupRequests/${id}/reviewedAt`] = now;
  updates[`users/${row.uid}/paymentRequests/${id}/status`] = status;
  updates[`users/${row.uid}/paymentRequests/${id}/reviewedAt`] = now;
  if (decision === 'reject') {
    updates[`users/${row.uid}/transactions/${id}/status`] = status;
    updates[`users/${row.uid}/transactions/${id}/reviewedAt`] = now;
  }
  await db.ref().update(updates);
  return {requestId:id, status};
});

exports.adminAdjustCredits = onCall(async req => {
  const adminUid = adminOf(req), uid = str(req.data?.uid, 128);
  const amount = int(req.data?.amount, 1, 100000), direction = req.data?.direction;
  if (!['add','subtract'].includes(direction)) throw new HttpsError('invalid-argument', 'Direction must be add or subtract.');
  const reason = str(req.data?.reason, 200), delta = direction === 'add' ? amount : -amount;
  const ref = db.ref(`users/${uid}/creditBalance`); let after;
  const result = await ref.transaction(v => {
    const current = Number.isSafeInteger(v) && v >= 0 ? v : 0;
    if (current + delta < 0) return;
    after = current + delta; return after;
  });
  if (!result.committed) throw new HttpsError('failed-precondition', 'Insufficient credits or update conflict.');
  const tx = db.ref(`users/${uid}/transactions`).push();
  await tx.set({type:'admin_adjustment', amount, direction, balanceAfter:after, reason, adminUid, createdAt:Date.now()});
  return {balance:after, transactionId:tx.key};
});

// Price is loaded from server-owned catalog/groupTiers; browser-supplied cost is ignored.
exports.launchGroup = onCall(async req => {
  uidOf(req);
  throw new HttpsError('failed-precondition', 'Actual authorized Group Launch provider is not configured. No credits were deducted.');
});


// Admin-only list endpoint; client never receives broad database read access.
exports.listTopupRequests = onCall(async req => {
  adminOf(req);
  const snap = await db.ref('topupRequests').get();
  const all = snap.val() || {};
  const requests = Object.entries(all).map(([requestId, row]) => ({requestId, ...row}));
  requests.sort((a,b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return {requests};
});


// Admin-only directory based on Firebase Authentication, not browser localStorage.
exports.listUsers = onCall(async req => {
  adminOf(req);
  const authResult = await getAuth().listUsers(1000);
  const usersSnap = await db.ref('users').get();
  const userData = usersSnap.val() || {};
  const users = authResult.users.map(u => {
    const data = userData[u.uid] || {};
    const profile = data.profile || {};
    return {
      uid: u.uid,
      email: u.email || '',
      displayName: u.displayName || profile.displayName || profile.username || (u.email || 'User'),
      disabled: !!u.disabled,
      createdAt: u.metadata?.creationTime || '',
      balance: Number.isSafeInteger(data.creditBalance) && data.creditBalance >= 0 ? data.creditBalance : 0
    };
  }).sort((a,b) => String(a.email).localeCompare(String(b.email)));
  return {users, truncated: authResult.pageToken != null};
});
