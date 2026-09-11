import styles from './Queue.module.css';

interface PaginationProps {
  total: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
}

export function Pagination({ total, page, pageSize, onPage }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className={styles.pagination}>
      <span>Showing {from}–{to} of {total}</span>
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Prev
      </button>
      <button type="button" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
        Next
      </button>
      <span>Page {page} of {pageCount}</span>
    </div>
  );
}
