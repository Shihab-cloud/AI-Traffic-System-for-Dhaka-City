// Firebase Cloud Messaging service worker.
// Lives at the domain root so its scope covers the entire app.
//
// These config values are PUBLIC — they are already exposed via the web
// SDK at runtime and are safe to hardcode. Do not paste any server-only
// credentials here.

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  // Fill in your own Firebase web app's values to use push notifications (off by default).
  apiKey: 'replace-with-firebase-web-api-key',
  projectId: 'replace-with-firebase-project-id',
  messagingSenderId: 'replace-with-sender-id',
  appId: 'replace-with-firebase-app-id',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || payload.data?.title || 'Notification';
  const options = {
    body: payload.notification?.body || payload.data?.body || '',
    icon: '/icon.png',
    data: payload.data || {},
  };
  self.registration.showNotification(title, options);
});
