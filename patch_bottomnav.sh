sed -i "s/import { Tv, Settings, PlayCircle, Compass } from 'lucide-react';/import { Tv, Settings, PlayCircle, Compass, User } from 'lucide-react';/" src/components/BottomNav.tsx
sed -i "s/    { id: 'settings', label: 'Réglages', icon: Settings },/    { id: 'profile', label: 'Profil', icon: User },\n    { id: 'settings', label: 'Réglages', icon: Settings },/" src/components/BottomNav.tsx
sed -i "s/| 'settings'/| 'settings' | 'profile'/g" src/components/BottomNav.tsx
