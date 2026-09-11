import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div style={{ padding: '40px 24px' }}>
      <h1>Page not found</h1>
      <p>
        <Link to="/">Back to queue</Link>
      </p>
    </div>
  );
}
