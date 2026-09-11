import styles from './Queue.module.css';

interface FilterChipsProps<T extends string> {
  label: string;
  options: T[];
  selected: T[];
  onToggle: (value: T) => void;
}

export function FilterChips<T extends string>({ label, options, selected, onToggle }: FilterChipsProps<T>) {
  return (
    <div className={styles.chipGroup} role="group" aria-label={label}>
      <span className={styles.chipGroupLabel}>{label}</span>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={`${styles.chip} ${selected.includes(option) ? styles.active : ''}`}
          aria-pressed={selected.includes(option)}
          onClick={() => onToggle(option)}
        >
          {option.replace('_', ' ')}
        </button>
      ))}
    </div>
  );
}
