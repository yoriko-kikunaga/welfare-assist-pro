import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyAV5L0QdLOI6pbKdp9k29k2RL2i65PglfE",
  authDomain: "welfare-assist-pro.firebaseapp.com",
  projectId: "welfare-assist-pro",
  storageBucket: "welfare-assist-pro.firebasestorage.app",
  messagingSenderId: "389880096786",
  appId: "1:389880096786:web:518abfa922b94277b150cb"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication
export const auth = getAuth(app);

// Google Auth Provider
export const googleProvider = new GoogleAuthProvider();

// Optional: Configure Google provider for Workspace accounts
googleProvider.setCustomParameters({
  prompt: 'select_account'
});
