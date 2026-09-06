import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function DashboardPage() {
  const { user } = useAuth();

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Welcome, {user?.firstName ?? user?.email}.</p>
      <p>
        Head to <Link to="/projects">Projects</Link> to create and manage your projects.
      </p>
    </div>
  );
}
