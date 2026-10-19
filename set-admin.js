// Run locally with a service-account JSON downloaded from Firebase Console. Never upload it.
const admin = require('firebase-admin');
const path = require('path');
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const uid = process.argv[2];
if (!keyPath || !uid) {
  console.error('Usage: GOOGLE_APPLICATION_CREDENTIALS=/secure/path/service-account.json node scripts/set-admin.js FIREBASE_AUTH_UID');
  process.exit(1);
}
admin.initializeApp({credential:admin.credential.cert(require(path.resolve(keyPath)))});
(async () => {
  const user = await admin.auth().getUser(uid);
  await admin.auth().setCustomUserClaims(uid, {...(user.customClaims || {}), admin:true});
  console.log(`Admin claim set for ${uid}. Sign out and sign in again.`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
