const fs = require('fs');
const file = fs.readFileSync('src/App.tsx', 'utf8');

if (file.includes('LoginScreen')) {
    console.log("Already patched");
    process.exit(0);
}

const importLines = `
import { useState, useEffect, useRef } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from './lib/firebase';
import { LoginScreen } from './screens/LoginScreen';
`;

let newFile = file.replace("import { useEffect, useRef } from 'react';", importLines);

const appDef = `
export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });
    return unsub;
  }, []);

  if (currentUser === undefined) {
    // Loading state
    return (
      <div className="w-full min-h-[100dvh] bg-[#040406] flex items-center justify-center">
         <div className="w-8 h-8 border-4 border-zinc-800 border-t-[#E5A93D] rounded-full animate-spin" />
      </div>
    );
  }

  if (currentUser === null) {
    return <LoginScreen />;
  }

  return <MainApp />;
}

function MainApp() {
`;

newFile = newFile.replace("export default function App() {", appDef);

fs.writeFileSync('src/App.tsx', newFile);
console.log("Patched App.tsx");
