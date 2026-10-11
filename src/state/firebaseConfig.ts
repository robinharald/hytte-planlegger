import type { FirebaseOptions } from 'firebase/app';

/**
 * Firebase project for the family's shared proposals ("delt plass"). These values are public by design
 * (they identify the project; access is governed by firestore.rules and the unguessable family id in the link).
 * Set to `null` to run the app in local-only mode (proposals saved per device, shared by links/files).
 */
export const firebaseConfig: FirebaseOptions | null = {
  apiKey: 'AIzaSyA_KDLydOsr9DJGxQ9IpJcaM4mr_UJFXj8',
  authDomain: 'hytte-planlegger.firebaseapp.com',
  projectId: 'hytte-planlegger',
  storageBucket: 'hytte-planlegger.firebasestorage.app',
  messagingSenderId: '614673146371',
  appId: '1:614673146371:web:795d9e07e079253e442436',
};
