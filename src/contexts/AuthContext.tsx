import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  User,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged
} from 'firebase/auth';
import { auth, googleProvider } from '../firebaseConfig';

interface AuthContextType {
  currentUser: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('[AuthProvider] Initializing Firebase auth...');

    // Check if running in E2E test mode
    const isE2ETestMode = window.location.search.includes('e2e_test_mode=true');

    if (isE2ETestMode) {
      console.log('[AuthProvider] E2E test mode detected - using mock user');
      // Create a mock user for E2E testing (auth.currentUser stays null at Firebase SDK level;
      // Firestore emulator uses permissive test rules set in beforeAll)
      const mockUser = {
        uid: 'test-user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        photoURL: null,
        emailVerified: true,
      } as User;

      setCurrentUser(mockUser);
      setLoading(false);
      return () => {}; // No cleanup needed for mock user
    }

    // Set a timeout to prevent infinite loading (5s for faster test feedback)
    const timeout = setTimeout(() => {
      console.warn('[AuthProvider] Firebase auth initialization timeout - setting loading to false');
      setLoading(false);
    }, 5000); // 5 second timeout for faster test feedback

    // Listen for auth state changes
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log('[AuthProvider] Auth state changed:', user ? 'User logged in' : 'No user');
      clearTimeout(timeout);
      setCurrentUser(user);
      setLoading(false);
    }, (error) => {
      console.error('[AuthProvider] Auth state change error:', error);
      clearTimeout(timeout);
      setLoading(false);
    });

    // Cleanup subscription and timeout on unmount
    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, []);

  const signInWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Error signing in with Google:', error);
      throw error;
    }
  };

  const signOut = async () => {
    try {
      await firebaseSignOut(auth);
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  };

  const value: AuthContextType = {
    currentUser,
    loading,
    signInWithGoogle,
    signOut
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
