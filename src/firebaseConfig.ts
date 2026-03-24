import { getApps, initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyAV5L0QdLOI6pbKdp9k29k2RL2i65PglfE",
  authDomain: "welfare-assist-pro.firebaseapp.com",
  projectId: "welfare-assist-pro",
  storageBucket: "welfare-assist-pro.firebasestorage.app",
  messagingSenderId: "389880096786",
  appId: "1:389880096786:web:518abfa922b94277b150cb"
};

// Initialize Firebase (HMR-safe: reuse existing app instance)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Initialize Firebase Authentication
export const auth = getAuth(app);

// Initialize Firestore
export const db = getFirestore(app);

// Connect to Firebase Emulators when VITE_USE_EMULATOR=true
// globalThis guard prevents double-connection across Vite HMR reloads
const _g = globalThis as { __emulatorsConnected?: boolean };
if (import.meta.env.VITE_USE_EMULATOR === 'true' && !_g.__emulatorsConnected) {
  _g.__emulatorsConnected = true;
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  console.log('[Firebase] Connected to emulators (Auth:9099, Firestore:8080)');
}

// Google Auth Provider
export const googleProvider = new GoogleAuthProvider();

// Optional: Configure Google provider for Workspace accounts
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

// Initialize Firebase Functions (Tokyo region)
export const functions = getFunctions(app, 'asia-northeast1');

// Initialize Firebase Storage
export const storage = getStorage(app);
