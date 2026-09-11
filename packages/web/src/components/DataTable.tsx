import type { ReactNode } from 'react';
import type { SortOrder } from '../api/types';
import styles from './Queue.module.css';

export interface TableColumn<T, S extends string> {
  key: S;
  label: string;
  render: (item: T) => ReactNode;
  className?: string | undefined;
}

interface DataTableProps<T extends { id: string }, S extends string> {
  items: T[];
  columns: TableColumn<T, S>[];
  sort: S;
  order: SortOrder;
  onSort: (sort: S) => void;
  onOpen: (id: string) => void;
  label: string;
  emptyMessage: string;
}

export function DataTable<T extends { id: string }, S extends string>({
  items, columns, sort, order, onSort, onOpen, label, emptyMessage,
}: DataTableProps<T, S>) {
  if (items.length === 0) {
    return <div className={styles.empty}>{emptyMessage}</div>;
  }
  return (
    <div className={styles.tableWrap}>
      <table aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sort === column.key;
              return (
                <th
                  key={column.key}
                  className={`${styles.sortable} ${column.className ?? ''}`}
                  aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button type="button" className={styles.sortButton} onClick={() => onSort(column.key)}>
                    {column.label}
                    <span
                      className={active ? styles.sortArrow : styles.sortArrowInactive}
                      aria-hidden="true"
                    >
                      {active ? (order === 'asc' ? '▲' : '▼') : '↕'}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              tabIndex={0}
              onClick={() => onOpen(item.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onOpen(item.id);
              }}
            >
              {columns.map((column) => (
                <td key={column.key} className={column.className}>{column.render(item)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
