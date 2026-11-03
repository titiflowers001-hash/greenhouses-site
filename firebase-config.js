// ============================================================
//  НАСТРОЙКА FIREBASE — заполни эти 6 строк своими данными
//  Где взять: console.firebase.google.com → твой проект →
//  ⚙️ Project settings → раздел "Your apps" → значок </>
// ============================================================

const firebaseConfig = {
  apiKey:            "AIzaSyAaa0EB065Jjg_F86QJLnUNIiKYt8sw3SM",
  authDomain:        "green-mama-5f32e.firebaseapp.com",
  projectId:         "green-mama-5f32e",
  storageBucket:     "green-mama-5f32e.firebasestorage.app",
  messagingSenderId: "604190273447",
  appId:             "1:604190273447:web:d3dee8f199f4fc123f9082"
};

// ============================================================
//  Вход в админку теперь через Firebase Authentication
//  (email + пароль). Пароль в коде больше не хранится.
// ============================================================
window.firebaseConfig = firebaseConfig;
