/**
 * One-time setup script to provision demo Firebase Auth accounts and assign Custom Claims.
 *
 * SECURITY NOTE (fixed): this script used to have a real password ('DemoPassword@2026')
 * hardcoded directly in this file, committed to a *public* GitHub repo, for an account with
 * admin rights (admin-demo@secondmedic.com). Anyone who read this file had a working admin
 * login. It also initialized against the wrong project id ('secondmedic-vialtrack' instead of
 * the real project, gen-lang-client-0401908863), so it likely never actually ran successfully
 * against production -- but check anyway: if 'admin-demo@secondmedic.com' exists in your real
 * Firebase Authentication user list, delete/disable it immediately and rotate anything it could
 * have touched, since that exact password has been sitting in public view.
 *
 * Passwords now come from environment variables (never committed) and default to a freshly
 * generated random one if you don't set them -- printed once to your terminal, never written to
 * this file or anywhere else.
 *
 * Usage:
 *   1. Download your service account key JSON from Firebase Console -> Project Settings -> Service Accounts
 *   2. Set GOOGLE_APPLICATION_CREDENTIALS="path/to/serviceAccountKey.json"
 *   3. Optionally set FIREBASE_PROJECT_ID (defaults to the real VialTrack project below) and any
 *      of DEMO_ADMIN_PASSWORD / DEMO_CLIENT_PASSWORD / DEMO_RIDER_PASSWORD
 *   4. Run: npm run set-claims
 */

import admin from 'firebase-admin';
import crypto from 'crypto';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0401908863';

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  try {
    admin.initializeApp({ projectId: PROJECT_ID });
    console.log(`✅ Initialized Firebase Admin with project ${PROJECT_ID}`);
  } catch (e) {
    console.error('❌ Error initializing Firebase Admin:', e);
  }
}

// Never store a generated password anywhere -- only print it once, to this terminal, for
// whoever ran the script to hand off (or discard, if the account isn't actually needed).
function randomPassword() {
  return crypto.randomBytes(9).toString('base64url');
}

function resolvePassword(envVarName) {
  const fromEnv = process.env[envVarName];
  if (fromEnv && fromEnv.length >= 6) return { password: fromEnv, generated: false };
  return { password: randomPassword(), generated: true };
}

const adminPw = resolvePassword('DEMO_ADMIN_PASSWORD');
const clientPw = resolvePassword('DEMO_CLIENT_PASSWORD');
const riderPw = resolvePassword('DEMO_RIDER_PASSWORD');

const DEMO_USERS = [
  {
    email: 'admin-demo@secondmedic.com',
    password: adminPw.password,
    generated: adminPw.generated,
    displayName: 'SecondMedic Admin Lead',
    claims: {
      role: 'admin'
    }
  },
  {
    email: 'lifecare-demo@secondmedic.com',
    password: clientPw.password,
    generated: clientPw.generated,
    displayName: 'Lifecare Diagnostics (Lab Ops)',
    claims: {
      role: 'client',
      clientId: 'client-lifecare'
    }
  },
  {
    email: 'rahul-demo@secondmedic.com',
    password: riderPw.password,
    generated: riderPw.generated,
    displayName: 'Rahul Sharma (Pickup Boy)',
    claims: {
      role: 'rider',
      riderId: 'rider-rahul'
    }
  }
];

async function setupDemoAccounts() {
  console.log('🚀 Setting up demo accounts and assigning custom claims in Firebase Auth...\n');

  for (const userConfig of DEMO_USERS) {
    try {
      let userRecord;
      let created = false;
      try {
        userRecord = await admin.auth().getUserByEmail(userConfig.email);
        console.log(`Found existing user: ${userConfig.email} (UID: ${userRecord.uid})`);
      } catch (err) {
        if (err.code === 'auth/user-not-found') {
          userRecord = await admin.auth().createUser({
            email: userConfig.email,
            password: userConfig.password,
            displayName: userConfig.displayName
          });
          created = true;
          console.log(`✨ Created new user: ${userConfig.email} (UID: ${userRecord.uid})`);
        } else {
          throw err;
        }
      }

      if (created && userConfig.generated) {
        console.log(`🔑 Generated password for ${userConfig.email}: ${userConfig.password}  (save this now -- it is not stored anywhere)`);
      }

      // Assign custom claims
      await admin.auth().setCustomUserClaims(userRecord.uid, userConfig.claims);
      console.log(`✅ Set custom claims on ${userConfig.email}:`, JSON.stringify(userConfig.claims));

      // Verify custom claims
      const updatedUser = await admin.auth().getUser(userRecord.uid);
      console.log(`🔒 Verified claims for ${userConfig.email}:`, updatedUser.customClaims);
      console.log('--------------------------------------------------');
    } catch (error) {
      console.error(`❌ Failed to configure ${userConfig.email}:`, error);
    }
  }

  console.log('\n🎉 Demo account provisioning finished.');
}

setupDemoAccounts().then(() => process.exit(0)).catch((err) => {
  console.error('Fatal error setting up accounts:', err);
  process.exit(1);
});
