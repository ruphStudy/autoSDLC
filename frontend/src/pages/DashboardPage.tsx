import { useAuth } from '../auth/AuthContext';

export function DashboardPage() {
  const { user } = useAuth();

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Welcome, {user?.firstName ?? user?.email}.</p>
      <p>Project management tools will appear here in a future sprint.</p>
    </div>
  );
}
