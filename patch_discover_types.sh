sed -i 's/{ media: TMDBMedia, onShowClick: (id: number) => void }/{ media: TMDBMedia, onShowClick: (id: number) => void, key?: React.Key }/g' src/screens/DiscoverScreen.tsx
sed -i 's/import { useDebounce } from '\''use-debounce'\'';//g' src/screens/DiscoverScreen.tsx
sed -i '/import { cn } from '\''..\/lib\/utils'\'';/a \
function useDebounce<T>(value: T, delay: number): [T] {\
  const [debouncedValue, setDebouncedValue] = useState<T>(value);\
  useEffect(() => {\
    const handler = setTimeout(() => {\
      setDebouncedValue(value);\
    }, delay);\
    return () => clearTimeout(handler);\
  }, [value, delay]);\
  return [debouncedValue];\
}' src/screens/DiscoverScreen.tsx
