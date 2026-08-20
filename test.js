const code = `
  const [runtime, setRuntime] = useState<number | null>((show as any).runtime || null);
  const [releaseYear, setReleaseYear] = useState<string | null>(
    show.firstAirDate ? show.firstAirDate.slice(0, 4) : null
  );
`;
