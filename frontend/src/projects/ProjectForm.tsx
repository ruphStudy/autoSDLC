import { useState, type FormEvent } from 'react';
import axios from 'axios';
import type { ProjectFormPayload, RepositoryType } from './types';

const STACK_PRESETS = [
  'React + NestJS + PostgreSQL',
  'Next.js + Node.js + MongoDB',
  'Let AI Recommend',
];

const URL_PATTERN = /^https?:\/\/\S+$/i;

export interface ProjectFormValues {
  name: string;
  brief: string;
  description: string;
  preferredStack: string;
  repositoryType: RepositoryType;
  repositoryUrl: string;
}

const EMPTY_VALUES: ProjectFormValues = {
  name: '',
  brief: '',
  description: '',
  preferredStack: '',
  repositoryType: 'NEW',
  repositoryUrl: '',
};

interface ProjectFormProps {
  initialValues?: Partial<ProjectFormValues>;
  submitLabel: string;
  onSubmit: (payload: ProjectFormPayload) => Promise<void>;
  onCancel?: () => void;
}

export function ProjectForm({ initialValues, submitLabel, onSubmit, onCancel }: ProjectFormProps) {
  const [values, setValues] = useState<ProjectFormValues>({ ...EMPTY_VALUES, ...initialValues });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = <K extends keyof ProjectFormValues>(key: K, value: ProjectFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const validate = (): string | null => {
    if (!values.name.trim()) {
      return 'Project name is required.';
    }
    if (values.name.trim().length > 200) {
      return 'Project name must be 200 characters or fewer.';
    }
    if (!values.brief.trim()) {
      return 'Project brief is required.';
    }
    if (
      values.repositoryType === 'EXISTING' &&
      values.repositoryUrl.trim() &&
      !URL_PATTERN.test(values.repositoryUrl.trim())
    ) {
      return 'Repository URL must be a valid http(s) URL.';
    }
    return null;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) {
      return;
    }

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        name: values.name.trim(),
        brief: values.brief.trim(),
        description: values.description.trim() || undefined,
        preferredStack: values.preferredStack.trim() || undefined,
        repositoryType: values.repositoryType,
        repositoryUrl:
          values.repositoryType === 'EXISTING' ? values.repositoryUrl.trim() || undefined : undefined,
      });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const message = err.response?.data?.message;
        setError(Array.isArray(message) ? message.join(' ') : message || 'Something went wrong. Please try again.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="project-form" onSubmit={handleSubmit}>
      <label htmlFor="name">Project name</label>
      <input
        id="name"
        type="text"
        value={values.name}
        onChange={(e) => update('name', e.target.value)}
        placeholder="e.g. Interview Preparation Platform"
      />

      <label htmlFor="brief">Project brief</label>
      <textarea
        id="brief"
        rows={6}
        value={values.brief}
        onChange={(e) => update('brief', e.target.value)}
        placeholder="Describe what you want built. This will drive the project analysis later."
      />

      <label htmlFor="description">Description (optional)</label>
      <input
        id="description"
        type="text"
        value={values.description}
        onChange={(e) => update('description', e.target.value)}
        placeholder="Short internal summary"
      />

      <label htmlFor="preferredStack">Preferred stack</label>
      <input
        id="preferredStack"
        list="stack-presets"
        type="text"
        value={values.preferredStack}
        onChange={(e) => update('preferredStack', e.target.value)}
        placeholder="e.g. React + NestJS + PostgreSQL"
      />
      <datalist id="stack-presets">
        {STACK_PRESETS.map((preset) => (
          <option key={preset} value={preset} />
        ))}
      </datalist>

      <label htmlFor="repositoryType">Repository</label>
      <select
        id="repositoryType"
        value={values.repositoryType}
        onChange={(e) => update('repositoryType', e.target.value as RepositoryType)}
      >
        <option value="NEW">New repository/project</option>
        <option value="EXISTING">Existing repository</option>
      </select>

      {values.repositoryType === 'EXISTING' && (
        <>
          <label htmlFor="repositoryUrl">Repository URL (optional)</label>
          <input
            id="repositoryUrl"
            type="text"
            value={values.repositoryUrl}
            onChange={(e) => update('repositoryUrl', e.target.value)}
            placeholder="https://github.com/your-org/your-repo"
          />
          <p className="form-hint">
            Connecting this repository happens in a later step — this just records the URL.
          </p>
        </>
      )}

      {error && <p className="form-error">{error}</p>}

      <div className="project-form-actions">
        <button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
