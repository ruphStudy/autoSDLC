import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthenticatedLayout } from './components/AuthenticatedLayout';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectsListPage } from './pages/ProjectsListPage';
import { CreateProjectPage } from './pages/CreateProjectPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { EditProjectPage } from './pages/EditProjectPage';
import { ProjectAnalysisPage } from './pages/ProjectAnalysisPage';
import { EditProjectAnalysisPage } from './pages/EditProjectAnalysisPage';
import { ProjectAnalysisVersionPage } from './pages/ProjectAnalysisVersionPage';
import { ArchitecturePage } from './pages/ArchitecturePage';
import { EditArchitecturePage } from './pages/EditArchitecturePage';
import { ArchitectureVersionPage } from './pages/ArchitectureVersionPage';
import { SprintPlanPage } from './pages/SprintPlanPage';
import { EditSprintPlanPage } from './pages/EditSprintPlanPage';
import { SprintPlanVersionPage } from './pages/SprintPlanVersionPage';
import { DevelopmentPage } from './pages/DevelopmentPage';
import { SprintReviewPage } from './pages/SprintReviewPage';
import { ProjectDeliveryPage } from './pages/ProjectDeliveryPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AuthenticatedLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsListPage />} />
        <Route path="projects/new" element={<CreateProjectPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="projects/:id/edit" element={<EditProjectPage />} />
        <Route path="projects/:id/analysis" element={<ProjectAnalysisPage />} />
        <Route path="projects/:id/analysis/edit" element={<EditProjectAnalysisPage />} />
        <Route
          path="projects/:id/analysis/versions/:version"
          element={<ProjectAnalysisVersionPage />}
        />
        <Route path="projects/:id/architecture" element={<ArchitecturePage />} />
        <Route path="projects/:id/architecture/edit" element={<EditArchitecturePage />} />
        <Route
          path="projects/:id/architecture/versions/:version"
          element={<ArchitectureVersionPage />}
        />
        <Route path="projects/:id/sprint-plan" element={<SprintPlanPage />} />
        <Route path="projects/:id/sprint-plan/edit" element={<EditSprintPlanPage />} />
        <Route
          path="projects/:id/sprint-plan/versions/:version"
          element={<SprintPlanVersionPage />}
        />
        <Route path="projects/:id/development" element={<DevelopmentPage />} />
        <Route path="projects/:id/sprints/:sprintId/review" element={<SprintReviewPage />} />
        <Route path="projects/:id/delivery" element={<ProjectDeliveryPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
