import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import { Messaging, getMessaging, getToken, onMessage } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

let appInstance: FirebaseApp | null = null;
let messagingInstance: Messaging | null = null;

/** Checks whether FCM is usable in the current environment. */
export function isFcmSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (!('Notification' in window)) return false;
  if (!('serviceWorker' in navigator)) return false;
  if (
    !firebaseConfig.apiKey ||
    !firebaseConfig.authDomain ||
    !firebaseConfig.projectId ||
    !firebaseConfig.messagingSenderId ||
    !firebaseConfig.appId ||
    !VAPID_KEY
  )
    return false;
  return true;
}

function getApp(): FirebaseApp {
  if (appInstance) return appInstance;
  const existing = getApps()[0];
  if (existing) {
    appInstance = existing;
    return existing;
  }
  appInstance = initializeApp(firebaseConfig);
  return appInstance;
}

function getMessagingInstance(): Messaging {
  if (messagingInstance) return messagingInstance;
  messagingInstance = getMessaging(getApp());
  return messagingInstance;
}

/**
 * Requests notification permission and returns the FCM registration token.
 *
 * Assumes the caller has already confirmed `isFcmSupported()`. Returns `null`
 * if the user denies permission or if the token request fails (e.g., no
 * service worker registered yet).
 */
export async function requestPermissionAndGetToken(): Promise<string | null> {
  if (!isFcmSupported()) return null;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  try {
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const messaging = getMessagingInstance();
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    return token || null;
  } catch (err) {
    console.warn('FCM token fetch failed', err);
    return null;
  }
}

/** Attaches a foreground-message listener. Returns unsubscribe. */
export function listenForegroundMessages(
  callback: (payload: {
    notification?: { title?: string; body?: string };
    data?: Record<string, string>;
  }) => void,
): () => void {
  if (!isFcmSupported()) return () => undefined;
  try {
    const messaging = getMessagingInstance();
    return onMessage(messaging, callback);
  } catch {
    return () => undefined;
  }
}
