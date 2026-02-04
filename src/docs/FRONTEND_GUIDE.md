# Frontend Integration Guide

This guide provides copy-paste ready code examples for integrating a React + TypeScript frontend with the Street Keeper API.

## Table of Contents

1. [Project Setup](#project-setup)
2. [TypeScript Types](#typescript-types)
3. [API Client - Fetch Version](#api-client---fetch-version)
4. [API Client - Axios Version](#api-client---axios-version)
5. [Service Modules](#service-modules)
6. [React Hooks](#react-hooks)
7. [Component Examples](#component-examples)
8. [Error Handling](#error-handling)
9. [Setup Checklist](#setup-checklist)

---

## Project Setup

### Environment Variables

Create `.env.local` in your React Vite project:

```bash
# .env.local
VITE_API_BASE_URL=http://localhost:8000/api/v1
VITE_STRAVA_CLIENT_ID=your_strava_client_id
```

### API Configuration

```typescript
// src/config/api.config.ts

export const API_CONFIG = {
  baseUrl: import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api/v1",
  stravaClientId: import.meta.env.VITE_STRAVA_CLIENT_ID,
} as const;
```

---

## TypeScript Types

Create a complete types file that mirrors backend response types:

```typescript
// src/types/api.types.ts

// ============================================
// Common Types
// ============================================

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  error?: string;
  code?: string;
  data?: T;
}

export interface ApiError {
  success: false;
  error: string;
  code: string;
}

// ============================================
// Auth Types
// ============================================

export interface AuthUser {
  id: string;
  name: string;
  email: string | null;
  stravaId: string | null;
  profilePic: string | null;
}

export interface AuthResponse {
  success: true;
  message: string;
  user: AuthUser;
}

// ============================================
// Project Types
// ============================================

export interface SnapshotStreet {
  osmId: string;
  name: string;
  lengthMeters: number;
  highwayType: string;
  completed: boolean;
  percentage: number;
  lastRunDate: string | null;
  isNew?: boolean;
}

export interface ProjectListItem {
  id: string;
  name: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  progress: number;
  totalStreets: number;
  completedStreets: number;
  totalLengthMeters: number;
  deadline: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetail extends ProjectListItem {
  streets: SnapshotStreet[];
  snapshotDate: string;
  inProgressCount: number;
  notStartedCount: number;
  refreshNeeded: boolean;
  daysSinceRefresh: number;
  newStreetsDetected?: number;
}

export interface ProjectPreview {
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  cachedRadiusMeters: number;
  cacheKey: string;
  totalStreets: number;
  totalLengthMeters: number;
  streetsByType: Record<string, number>;
  warnings: string[];
}

export interface CreateProjectRequest {
  name: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: 500 | 1000 | 2000 | 5000 | 10000;
  deadline?: string;
  cacheKey?: string;
}

export interface ProjectsListResponse {
  success: true;
  projects: ProjectListItem[];
  total: number;
}

export interface ProjectDetailResponse {
  success: true;
  project: ProjectDetail;
  warning?: string;
}

export interface ProjectPreviewResponse {
  success: true;
  preview: ProjectPreview;
}

// ============================================
// Activity Types
// ============================================

export interface ActivityListItem {
  id: string;
  stravaId: string;
  name: string;
  distanceMeters: number;
  durationSeconds: number;
  startDate: string;
  activityType: string;
  isProcessed: boolean;
  createdAt: string;
  projectsAffected?: number;
  streetsCompleted?: number;
  streetsImproved?: number;
}

export interface ActivityImpact {
  completed: string[];
  improved: Array<{
    osmId: string;
    from: number;
    to: number;
  }>;
}

export interface GpxPoint {
  lat: number;
  lng: number;
  elevation?: number;
  timestamp?: string;
}

export interface ActivityDetail extends ActivityListItem {
  coordinates: GpxPoint[];
  processedAt: string | null;
  projectImpacts: Array<{
    projectId: string;
    projectName: string;
    streetsCompleted: number;
    streetsImproved: number;
    impactDetails: ActivityImpact | null;
  }>;
}

export interface ActivitiesListResponse {
  success: true;
  activities: ActivityListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ActivityDetailResponse {
  success: true;
  activity: ActivityDetail;
}

// ============================================
// GPX Analysis Types
// ============================================

export interface AggregatedStreet {
  name: string;
  normalizedName: string;
  highwayType: string;
  totalLengthMeters: number;
  totalDistanceCoveredMeters: number;
  totalDistanceRunMeters: number;
  coverageRatio: number;
  rawCoverageRatio: number;
  completionStatus: "FULL" | "PARTIAL";
  segmentCount: number;
  segmentOsmIds: string[];
}

export interface GpxAnalysisResponse {
  success: true;
  analysis: {
    gpxName: string;
    totalDistanceMeters: number;
    durationSeconds: number | null;
    pointsCount: number;
    streetsTotal: number;
    streetsFullCount: number;
    streetsPartialCount: number;
    percentageFullStreets: number;
  };
  streets: {
    total: number;
    fullCount: number;
    partialCount: number;
    list: AggregatedStreet[];
  };
}
```

---

## API Client - Fetch Version

```typescript
// src/services/api-client.fetch.ts

import { API_CONFIG } from "../config/api.config";
import type { ApiError as ApiErrorType } from "../types/api.types";

class ApiClientFetch {
  private baseUrl: string;
  private authToken: string | null = null;

  constructor() {
    this.baseUrl = API_CONFIG.baseUrl;
  }

  setAuthToken(token: string | null) {
    this.authToken = token;
  }

  setDevUserId(userId: string | null) {
    this.authToken = userId;
  }

  private getHeaders(contentType: "json" | "multipart" = "json"): HeadersInit {
    const headers: HeadersInit = {};

    if (contentType === "json") {
      headers["Content-Type"] = "application/json";
    }

    if (this.authToken) {
      // Development mode uses x-user-id header
      headers["x-user-id"] = this.authToken;
      // Production: headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    return headers;
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    const data = await response.json();

    if (!response.ok) {
      const error = data as ApiErrorType;
      throw new ApiError(error.error, error.code, response.status);
    }

    return data as T;
  }

  async get<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: this.getHeaders(),
      credentials: "include",
    });

    return this.handleResponse<T>(response);
  }

  async post<T>(endpoint: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: this.getHeaders(),
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
    });

    return this.handleResponse<T>(response);
  }

  async postFormData<T>(endpoint: string, formData: FormData): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: this.getHeaders("multipart"),
      credentials: "include",
      body: formData,
    });

    return this.handleResponse<T>(response);
  }

  async delete<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "DELETE",
      headers: this.getHeaders(),
      credentials: "include",
    });

    return this.handleResponse<T>(response);
  }
}

export class ApiError extends Error {
  constructor(message: string, public code: string, public status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export const apiClient = new ApiClientFetch();
```

---

## API Client - Axios Version

```typescript
// src/services/api-client.axios.ts

import axios, { AxiosInstance, AxiosError } from "axios";
import { API_CONFIG } from "../config/api.config";
import type { ApiError as ApiErrorType } from "../types/api.types";

class ApiClientAxios {
  private client: AxiosInstance;
  private authToken: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_CONFIG.baseUrl,
      withCredentials: true,
      headers: {
        "Content-Type": "application/json",
      },
    });

    this.client.interceptors.request.use((config) => {
      if (this.authToken) {
        config.headers["x-user-id"] = this.authToken;
      }
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError<ApiErrorType>) => {
        if (error.response?.data) {
          throw new ApiError(
            error.response.data.error,
            error.response.data.code || "UNKNOWN_ERROR",
            error.response.status
          );
        }
        throw new ApiError(
          error.message || "Network error",
          "NETWORK_ERROR",
          0
        );
      }
    );
  }

  setAuthToken(token: string | null) {
    this.authToken = token;
  }

  setDevUserId(userId: string | null) {
    this.authToken = userId;
  }

  async get<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const response = await this.client.get<T>(endpoint, { params });
    return response.data;
  }

  async post<T>(endpoint: string, body?: unknown): Promise<T> {
    const response = await this.client.post<T>(endpoint, body);
    return response.data;
  }

  async postFormData<T>(endpoint: string, formData: FormData): Promise<T> {
    const response = await this.client.post<T>(endpoint, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return response.data;
  }

  async delete<T>(endpoint: string): Promise<T> {
    const response = await this.client.delete<T>(endpoint);
    return response.data;
  }
}

export class ApiError extends Error {
  constructor(message: string, public code: string, public status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export const apiClient = new ApiClientAxios();
```

---

## Service Modules

### Auth Service

```typescript
// src/services/auth.service.ts

import { apiClient } from "./api-client.fetch";
import { API_CONFIG } from "../config/api.config";
import type { AuthResponse } from "../types/api.types";

export const authService = {
  getStravaAuthUrl(): string {
    return `${API_CONFIG.baseUrl}/auth/strava`;
  },

  loginWithStrava(): void {
    window.location.href = this.getStravaAuthUrl();
  },

  async handleStravaCallback(code: string): Promise<AuthResponse> {
    return apiClient.get<AuthResponse>("/auth/strava/callback", { code });
  },

  async getCurrentUser(): Promise<AuthResponse> {
    return apiClient.get<AuthResponse>("/auth/me");
  },

  logout(): void {
    apiClient.setAuthToken(null);
    localStorage.removeItem("street-keeper-user");
  },

  // Development only
  setDevUser(userId: string): void {
    apiClient.setDevUserId(userId);
    localStorage.setItem("street-keeper-dev-user", userId);
  },

  restoreDevUser(): string | null {
    const userId = localStorage.getItem("street-keeper-dev-user");
    if (userId) {
      apiClient.setDevUserId(userId);
    }
    return userId;
  },
};
```

### Projects Service

```typescript
// src/services/projects.service.ts

import { apiClient } from "./api-client.fetch";
import type {
  ProjectsListResponse,
  ProjectDetailResponse,
  ProjectPreviewResponse,
  CreateProjectRequest,
} from "../types/api.types";

export const projectsService = {
  async getAll(): Promise<ProjectsListResponse> {
    return apiClient.get<ProjectsListResponse>("/projects");
  },

  async getById(projectId: string): Promise<ProjectDetailResponse> {
    return apiClient.get<ProjectDetailResponse>(`/projects/${projectId}`);
  },

  async preview(
    centerLat: number,
    centerLng: number,
    radiusMeters: 500 | 1000 | 2000 | 5000 | 10000
  ): Promise<ProjectPreviewResponse> {
    return apiClient.get<ProjectPreviewResponse>("/projects/preview", {
      lat: centerLat.toString(),
      lng: centerLng.toString(),
      radius: radiusMeters.toString(),
    });
  },

  async create(data: CreateProjectRequest): Promise<ProjectDetailResponse> {
    return apiClient.post<ProjectDetailResponse>("/projects", data);
  },

  async delete(projectId: string): Promise<{ success: true; message: string }> {
    return apiClient.delete(`/projects/${projectId}`);
  },

  async refresh(projectId: string): Promise<ProjectDetailResponse> {
    return apiClient.post<ProjectDetailResponse>(
      `/projects/${projectId}/refresh`
    );
  },
};
```

### Activities Service

```typescript
// src/services/activities.service.ts

import { apiClient } from "./api-client.fetch";
import type {
  ActivitiesListResponse,
  ActivityDetailResponse,
} from "../types/api.types";

export const activitiesService = {
  async getAll(page = 1, pageSize = 20): Promise<ActivitiesListResponse> {
    return apiClient.get<ActivitiesListResponse>("/activities", {
      page: page.toString(),
      pageSize: pageSize.toString(),
    });
  },

  async getById(activityId: string): Promise<ActivityDetailResponse> {
    return apiClient.get<ActivityDetailResponse>(`/activities/${activityId}`);
  },

  async delete(
    activityId: string
  ): Promise<{ success: true; message: string }> {
    return apiClient.delete(`/activities/${activityId}`);
  },
};
```

### GPX Service

```typescript
// src/services/gpx.service.ts

import { apiClient } from "./api-client.fetch";
import type { GpxAnalysisResponse } from "../types/api.types";

export const gpxService = {
  async analyze(file: File): Promise<GpxAnalysisResponse> {
    const formData = new FormData();
    formData.append("gpx", file);
    return apiClient.postFormData<GpxAnalysisResponse>(
      "/runs/analyze-gpx",
      formData
    );
  },
};
```

---

## React Hooks

### useProjects

```typescript
// src/hooks/useProjects.ts

import { useState, useEffect, useCallback } from "react";
import { projectsService } from "../services/projects.service";
import type { ProjectListItem } from "../types/api.types";
import { ApiError } from "../services/api-client.fetch";

interface UseProjectsReturn {
  projects: ProjectListItem[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useProjects(): UseProjectsReturn {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await projectsService.getAll();
      setProjects(response.projects);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to fetch projects");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  return { projects, loading, error, refetch: fetchProjects };
}
```

### useProjectDetail

```typescript
// src/hooks/useProjectDetail.ts

import { useState, useEffect, useCallback } from "react";
import { projectsService } from "../services/projects.service";
import type { ProjectDetail } from "../types/api.types";
import { ApiError } from "../services/api-client.fetch";

interface UseProjectDetailReturn {
  project: ProjectDetail | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useProjectDetail(
  projectId: string | null
): UseProjectDetailReturn {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProject = useCallback(async () => {
    if (!projectId) return;

    try {
      setLoading(true);
      setError(null);
      const response = await projectsService.getById(projectId);
      setProject(response.project);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to fetch project");
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  return { project, loading, error, refetch: fetchProject };
}
```

### useActivities

```typescript
// src/hooks/useActivities.ts

import { useState, useEffect, useCallback } from "react";
import { activitiesService } from "../services/activities.service";
import type { ActivityListItem } from "../types/api.types";
import { ApiError } from "../services/api-client.fetch";

interface UseActivitiesReturn {
  activities: ActivityListItem[];
  loading: boolean;
  error: string | null;
  pagination: {
    page: number;
    totalPages: number;
    total: number;
  };
  goToPage: (page: number) => void;
  refetch: () => Promise<void>;
}

export function useActivities(
  initialPage = 1,
  pageSize = 20
): UseActivitiesReturn {
  const [activities, setActivities] = useState<ActivityListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(initialPage);
  const [pagination, setPagination] = useState({
    page: 1,
    totalPages: 1,
    total: 0,
  });

  const fetchActivities = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await activitiesService.getAll(page, pageSize);
      setActivities(response.activities);
      setPagination({
        page: response.page,
        totalPages: Math.ceil(response.total / pageSize),
        total: response.total,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to fetch activities");
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  return {
    activities,
    loading,
    error,
    pagination,
    goToPage: setPage,
    refetch: fetchActivities,
  };
}
```

### useProjectPreview

```typescript
// src/hooks/useProjectPreview.ts

import { useState, useCallback } from "react";
import { projectsService } from "../services/projects.service";
import type { ProjectPreview } from "../types/api.types";
import { ApiError } from "../services/api-client.fetch";

interface UseProjectPreviewReturn {
  preview: ProjectPreview | null;
  loading: boolean;
  error: string | null;
  fetchPreview: (
    lat: number,
    lng: number,
    radius: 500 | 1000 | 2000 | 5000 | 10000
  ) => Promise<void>;
  clearPreview: () => void;
}

export function useProjectPreview(): UseProjectPreviewReturn {
  const [preview, setPreview] = useState<ProjectPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPreview = useCallback(
    async (
      lat: number,
      lng: number,
      radius: 500 | 1000 | 2000 | 5000 | 10000
    ) => {
      try {
        setLoading(true);
        setError(null);
        const response = await projectsService.preview(lat, lng, radius);
        setPreview(response.preview);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("Failed to fetch preview");
        }
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const clearPreview = () => {
    setPreview(null);
    setError(null);
  };

  return { preview, loading, error, fetchPreview, clearPreview };
}
```

### useCreateProject

```typescript
// src/hooks/useCreateProject.ts

import { useState, useCallback } from "react";
import { projectsService } from "../services/projects.service";
import type { CreateProjectRequest, ProjectDetail } from "../types/api.types";
import { ApiError } from "../services/api-client.fetch";

interface UseCreateProjectReturn {
  createProject: (data: CreateProjectRequest) => Promise<ProjectDetail | null>;
  loading: boolean;
  error: string | null;
  clearError: () => void;
}

export function useCreateProject(): UseCreateProjectReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createProject = useCallback(
    async (data: CreateProjectRequest): Promise<ProjectDetail | null> => {
      try {
        setLoading(true);
        setError(null);
        const response = await projectsService.create(data);
        return response.project;
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("Failed to create project");
        }
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { createProject, loading, error, clearError: () => setError(null) };
}
```

---

## Component Examples

### Login Page

```typescript
// src/pages/LoginPage.tsx

import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { authService } from "../services/auth.service";

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const code = searchParams.get("code");
    const error = searchParams.get("error");

    if (error) {
      console.error("Strava auth denied:", error);
      return;
    }

    if (code) {
      authService
        .handleStravaCallback(code)
        .then((response) => {
          console.log("Logged in as:", response.user.name);
          navigate("/dashboard");
        })
        .catch((err) => {
          console.error("Login failed:", err.message);
        });
    }
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-white mb-8">Street Keeper</h1>
        <button
          onClick={() => authService.loginWithStrava()}
          className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 px-6 rounded-lg"
        >
          Login with Strava
        </button>
      </div>
    </div>
  );
}
```

### Projects List Page

```typescript
// src/pages/ProjectsPage.tsx

import { Link } from "react-router-dom";
import { useProjects } from "../hooks/useProjects";

export function ProjectsPage() {
  const { projects, loading, error, refetch } = useProjects();

  if (loading) {
    return <div className="p-8 text-white">Loading projects...</div>;
  }

  if (error) {
    return (
      <div className="p-8">
        <p className="text-red-400">Error: {error}</p>
        <button
          onClick={refetch}
          className="mt-4 text-blue-400 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-white">My Projects</h1>
        <Link
          to="/projects/new"
          className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded"
        >
          Create New Project
        </Link>
      </div>

      {projects.length === 0 ? (
        <p className="text-gray-400">No projects yet. Create your first one!</p>
      ) : (
        <div className="grid gap-4">
          {projects.map((project) => (
            <Link
              key={project.id}
              to={`/projects/${project.id}`}
              className="block p-4 bg-gray-800 rounded-lg hover:bg-gray-700"
            >
              <h3 className="text-lg font-semibold text-white">
                {project.name}
              </h3>
              <p className="text-gray-400">
                {project.completedStreets}/{project.totalStreets} streets (
                {project.progress.toFixed(1)}%)
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Create Project Page

```typescript
// src/pages/CreateProjectPage.tsx

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProjectPreview } from "../hooks/useProjectPreview";
import { useCreateProject } from "../hooks/useCreateProject";

const RADIUS_OPTIONS = [500, 1000, 2000, 5000, 10000] as const;

export function CreateProjectPage() {
  const navigate = useNavigate();
  const {
    preview,
    loading: previewLoading,
    error: previewError,
    fetchPreview,
  } = useProjectPreview();
  const {
    createProject,
    loading: createLoading,
    error: createError,
  } = useCreateProject();

  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radius, setRadius] = useState<500 | 1000 | 2000 | 5000 | 10000>(2000);

  const handlePreview = () => {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (!isNaN(latNum) && !isNaN(lngNum)) {
      fetchPreview(latNum, lngNum, radius);
    }
  };

  const handleCreate = async () => {
    if (!name || !preview) return;

    const project = await createProject({
      name,
      centerLat: preview.centerLat,
      centerLng: preview.centerLng,
      radiusMeters: radius,
      cacheKey: preview.cacheKey,
    });

    if (project) {
      navigate(`/projects/${project.id}`);
    }
  };

  const handleUseCurrentLocation = () => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(position.coords.latitude.toString());
        setLng(position.coords.longitude.toString());
      },
      (error) => console.error("Geolocation error:", error)
    );
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-6">Create New Project</h1>

      <div className="space-y-4">
        <div>
          <label className="block text-gray-300 mb-2">Project Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full p-2 bg-gray-800 text-white rounded border border-gray-600"
            placeholder="My Neighbourhood"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-gray-300 mb-2">Latitude</label>
            <input
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              className="w-full p-2 bg-gray-800 text-white rounded border border-gray-600"
              placeholder="50.788"
            />
          </div>
          <div>
            <label className="block text-gray-300 mb-2">Longitude</label>
            <input
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              className="w-full p-2 bg-gray-800 text-white rounded border border-gray-600"
              placeholder="-1.089"
            />
          </div>
        </div>

        <button
          onClick={handleUseCurrentLocation}
          className="text-blue-400 hover:underline text-sm"
        >
          Use Current Location
        </button>

        <div>
          <label className="block text-gray-300 mb-2">Radius</label>
          <select
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value) as typeof radius)}
            className="w-full p-2 bg-gray-800 text-white rounded border border-gray-600"
          >
            {RADIUS_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r >= 1000 ? `${r / 1000}km` : `${r}m`}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={handlePreview}
          disabled={previewLoading}
          className="w-full bg-gray-600 hover:bg-gray-500 text-white py-2 rounded"
        >
          {previewLoading ? "Loading..." : "Preview Streets"}
        </button>

        {previewError && <p className="text-red-400">{previewError}</p>}

        {preview && (
          <div className="p-4 bg-gray-800 rounded">
            <h3 className="text-lg font-semibold text-white mb-2">Preview</h3>
            <p className="text-gray-300">
              {preview.totalStreets} streets found
            </p>
            <p className="text-gray-400 text-sm">
              Total length: {(preview.totalLengthMeters / 1000).toFixed(1)}km
            </p>

            {preview.warnings.map((warning, i) => (
              <p key={i} className="text-yellow-400 text-sm mt-2">
                {warning}
              </p>
            ))}

            <button
              onClick={handleCreate}
              disabled={createLoading || !name}
              className="mt-4 w-full bg-blue-500 hover:bg-blue-600 text-white py-2 rounded"
            >
              {createLoading ? "Creating..." : "Create Project"}
            </button>

            {createError && <p className="text-red-400 mt-2">{createError}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
```

### GPX Upload Component

```typescript
// src/components/GpxUpload.tsx

import { useState, useRef } from "react";
import { gpxService } from "../services/gpx.service";
import type { GpxAnalysisResponse } from "../types/api.types";
import { ApiError } from "../services/api-client.fetch";

export function GpxUpload() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [analysis, setAnalysis] = useState<GpxAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setLoading(true);
      setError(null);
      const result = await gpxService.analyze(file);
      setAnalysis(result);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to analyze GPX file");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 bg-gray-800 rounded-lg">
      <h2 className="text-xl font-bold text-white mb-4">Analyze GPX File</h2>

      <input
        ref={fileInputRef}
        type="file"
        accept=".gpx"
        onChange={handleFileChange}
        disabled={loading}
        className="text-gray-300"
      />

      {loading && <p className="text-gray-400 mt-4">Analyzing...</p>}
      {error && <p className="text-red-400 mt-4">{error}</p>}

      {analysis && (
        <div className="mt-6">
          <h3 className="text-lg font-semibold text-white">
            {analysis.analysis.gpxName}
          </h3>
          <p className="text-gray-400">
            Distance:{" "}
            {(analysis.analysis.totalDistanceMeters / 1000).toFixed(2)} km
          </p>
          <p className="text-gray-400">
            Streets: {analysis.streets.fullCount} complete,{" "}
            {analysis.streets.partialCount} partial
          </p>

          <h4 className="text-white font-semibold mt-4 mb-2">
            Streets Covered
          </h4>
          <ul className="space-y-1">
            {analysis.streets.list.slice(0, 10).map((street) => (
              <li key={street.normalizedName} className="text-gray-300">
                {street.name}: {(street.coverageRatio * 100).toFixed(0)}%
                <span
                  className={
                    street.completionStatus === "FULL"
                      ? "text-green-400"
                      : "text-yellow-400"
                  }
                >
                  {" "}
                  ({street.completionStatus})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

---

## Error Handling

```typescript
// src/utils/error-handling.ts

import { ApiError } from "../services/api-client.fetch";

const errorMessages: Record<string, string> = {
  AUTH_DENIED: "You denied access. Please try logging in again.",
  AUTH_REQUIRED: "Please log in to continue.",
  PROJECT_NOT_FOUND: "This project no longer exists.",
  PROJECT_ACCESS_DENIED: "You do not have access to this project.",
  PROJECT_NO_STREETS:
    "No streets found in this area. Try a different location.",
  GPX_PARSE_ERROR: "Could not read the GPX file. Please check the file format.",
  OVERPASS_API_ERROR:
    "Street data service is temporarily unavailable. Please try again.",
};

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return errorMessages[error.code] || error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "An unexpected error occurred";
}

export function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function isRetryableError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 502;
}
```

---

## Setup Checklist

### 1. Create React Project

```bash
npm create vite@latest street-keeper-frontend -- --template react-ts
cd street-keeper-frontend
npm install axios react-router-dom
npm install -D @types/react-router-dom
```

### 2. Configure Environment

Create `.env.local`:

```bash
VITE_API_BASE_URL=http://localhost:8000/api/v1
```

### 3. Copy Files

Copy these files from this guide:

- `src/config/api.config.ts`
- `src/types/api.types.ts`
- `src/services/api-client.fetch.ts` (or axios version)
- `src/services/auth.service.ts`
- `src/services/projects.service.ts`
- `src/services/activities.service.ts`
- `src/services/gpx.service.ts`
- `src/hooks/*.ts`

### 4. Set Up Routing

```typescript
// src/App.tsx

import { BrowserRouter, Routes, Route } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { CreateProjectPage } from "./pages/CreateProjectPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/new" element={<CreateProjectPage />} />
      </Routes>
    </BrowserRouter>
  );
}
```

### 5. Test Connection

```bash
# Start backend
cd backend && npm run dev

# Start frontend
cd frontend && npm run dev

# Test API
curl http://localhost:8000/health
```

### 6. Development Auth

For local development without Strava OAuth:

```typescript
// In your app initialization
import { authService } from "./services/auth.service";

// Set a test user ID (get from database)
authService.setDevUser("your-test-user-uuid");
```
