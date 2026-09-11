import { useEffect, useRef, useState } from 'react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

export function SearchInput({ value, onChange, placeholder }: SearchInputProps) {
  const [input, setInput] = useState(value);
  const timer = useRef<number | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    window.clearTimeout(timer.current);
    setInput(value);
  }, [value]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <input
      type="search"
      aria-label="Search"
      placeholder={placeholder}
      maxLength={100}
      value={input}
      onChange={(event) => {
        const next = event.target.value;
        setInput(next);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => onChangeRef.current(next), 300);
      }}
    />
  );
}
