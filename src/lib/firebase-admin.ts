import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

const adminApp = getApps().length
  ? getApp()
  : initializeApp({
      projectId: firebaseConfig.projectId,
    });

export const adminDb = getFirestore(adminApp, firebaseConfig.firestoreDatabaseId);
adminDb.settings({ ignoreUndefinedProperties: true });
export const adminAuth = getAuth(adminApp);
