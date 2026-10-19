# FF PANDA GLORY STORE — Integrated Firebase package

এই ZIP-এ `index.html` এবং Firebase Cloud Functions / Realtime Database Rules / Storage Rules একসঙ্গে রাখা হয়েছে। এটি **কোড প্যাকেজ**, লাইভ deploy নয়। Firebase/GitHub-এ পরিবর্তন করে চালানোর আগে নিচের ধাপগুলো অনুসরণ করো।

## কী যুক্ত আছে
- Firebase Email/Password Authentication দিয়ে Admin sign-in; Admin permission server-issued `admin` custom claim থেকে যাচাই হয়।
- Credit Balance ও Transaction History Firebase Realtime Database থেকে পড়া হয়।
- Payment screenshot নিজের `payment-screenshots/{uid}/` Storage folder-এ upload হয়।
- `submitTopup` Pending request তৈরি করে; সঙ্গে সঙ্গে credit দেয় না।
- `listTopupRequests` Admin-only payment list দেয়।
- `reviewTopup` Admin-only approve/reject; approval retry হলে duplicate credit এড়াতে idempotency marker ব্যবহার করে।
- `listUsers` Admin-only Firebase Authentication directory এবং server-side balance দেয় (প্রথম 1,000 account পর্যন্ত)।
- `adminAdjustCredits` Admin-only balance adjustment করে এবং transaction log লেখে।
- প্রকৃত authorized Group Launch provider configure করা নেই; `launchGroup` নিরাপদে fail করে এবং credit কাটে না।

## আগে ব্যাকআপ ও টেস্ট
1. বর্তমান GitHub repository এবং Firebase Realtime Database-এর backup রাখো।
2. সম্ভব হলে আলাদা Firebase test project-এ আগে পরীক্ষা করো।
3. এই ZIP-এর `index.html` ও `ff-panda-backend/` ফোল্ডার রাখো। HTML-টি repository root-এ `index.html` নামে থাকবে।
4. Firebase Console → Authentication → Sign-in method-এ Email/Password চালু আছে কি না যাচাই করো। Admin account-টি Authentication → Users-এ থাকতে হবে।

## Backend deploy (নিজের কম্পিউটার থেকে)
Node.js 20 এবং Firebase CLI লাগবে। ZIP extract করে `ff-panda-backend` ফোল্ডারে terminal খুলে চালাও:

```bash
npm install -g firebase-tools
firebase login
firebase use --add
```

`firebase use --add`-এ তোমার সঠিক project `shivam-apex-clutch-web` বেছে নাও—প্রজেক্টের নাম মিলিয়ে নিশ্চিত না হয়ে এগোবে না। তারপর:

```bash
cd functions
npm install
cd ..
firebase deploy --only functions,database,storage
```

**সতর্কতা:** Database Rules direct client writes বন্ধ করে। পুরোনো localStorage-ভিত্তিক feature-গুলো এই package-এ পুরো migrate করা হয়নি; তাই production Rules deploy করলে অন্য পুরোনো feature বন্ধ হতে পারে। আগে test project-এ যাচাই করো।

## Admin claim সেট করা
Admin UID-টি Firebase Console → Authentication → Users থেকে যাচাই করো. তোমার দেওয়া UID-টি `ma0J72duu1bOcJBsv6HUK7FfGy93`; deploy করার আগে Console-এ email `shivamdhara900@gmail.com`-এর পাশে এই UID-ই আছে কি না নিশ্চিত করো।

Firebase Console থেকে Service Account key ডাউনলোড করতে হলে সেটি **শুধু নিজের কম্পিউটারে** রাখবে; ZIP, GitHub, Website বা chat-এ upload করবে না। তারপর নিজের কম্পিউটারে key path সেট করে চালাও:

Linux/macOS:
```bash
export GOOGLE_APPLICATION_CREDENTIALS="/secure/path/service-account.json"
node scripts/set-admin.js "ma0J72duu1bOcJBsv6HUK7FfGy93"
```

Windows PowerShell:
```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\secure\service-account.json"
node scripts/set-admin.js "ma0J72duu1bOcJBsv6HUK7FfGy93"
```

তারপর Admin account থেকে sign out করে আবার sign in করো। Service Account key কখনো GitHub-এ commit কোরো না।

## অবশ্যই পরীক্ষা করবে
- Normal user `creditBalance`, transaction বা payment status সরাসরি write করতে পারে না।
- Normal user অন্য UID-এর data পড়তে পারে না।
- Duplicate UTR প্রত্যাখ্যাত হয়।
- Pending payment approve করলে একবারই credit যোগ হয়।
- Reject করলে credit যোগ হয় না।
- Admin claim ছাড়া `listTopupRequests`, `listUsers`, `reviewTopup`, `adminAdjustCredits` ব্যর্থ হয়।
- Storage-এ user শুধু নিজের screenshot path-এ image upload করতে পারে।
- Hosting-এর URL থেকে login, payment request এবং admin approval পরীক্ষা করো।

## সীমাবদ্ধতা
- এই প্যাকেজ তোমার Firebase বা GitHub-এ নিজে থেকে deploy হয়নি।
- Payment provider-এর সঙ্গে স্বয়ংক্রিয় payment verification নেই; Admin-কে UTR/payment বাস্তবে যাচাই করতে হবে।
- Coupon, account activation/deletion, rename এবং অন্যান্য পুরোনো localStorage feature-এর সম্পূর্ণ server-side migration এই package-এ নেই।
- Group Launch API না থাকায় বাস্তব Guild Glory launch চালু করা হয়নি।
- Production-এ ব্যবহারের আগে end-to-end security test ও Firebase Rules review আবশ্যক।
