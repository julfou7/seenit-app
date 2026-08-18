sed -i '/return () => {/,/return unsubscribe;/c\
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {\
      setUser(currentUser);\
    });\
    return () => {\
      window.removeEventListener('\''storage'\'', handleStorage);\
      unsubscribe();\
    };\
  }, []);' src/screens/SettingsScreen.tsx
