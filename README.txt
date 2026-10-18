MedServ Care platform (website + working backend)

RUN IT ON YOUR COMPUTER
1. Install Node.js (LTS version) from nodejs.org, once.
2. Open this folder, click the address bar, type cmd, press Enter.
3. Type:  node server.js
4. First run prints the admin login. Save that password.
5. Open http://localhost:3000 in your browser.

WHAT WORKS
- Accounts for hospitals, engineers, suppliers and an admin.
- Engineers need admin verification before getting jobs (log in as admin, press Verify).
- Job matching: a request goes to the nearest verified engineer who covers that equipment.
- Escalation to a senior engineer (admin marks senior engineers), job reports, invoices.
- Spare-parts directory with search.
- Payments: manual mode by default (hospital enters a transfer reference, admin confirms).
  For online payment set CHAPA_SECRET_KEY (needs a Chapa merchant account) before running.

TO PUT IT ONLINE
Netlify cannot run this (it needs Node). Use Render, Railway or Fly.io. Free disks may reset, so use a persistent disk.
Your data is in data/db.json. Back it up. For many users, move to a real database.

NOT BUILT YET: email/SMS alerts, password reset, live video chat, ratings, request limits.
