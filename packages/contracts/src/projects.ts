// Project CRUD contracts. Slice 8 fills out CRUD; Slice 1 uses Project for routing.

export type Fidelity = 'wireframe' | 'high';

export type ProjectType = 'prototype' | 'slide_deck' | 'design_system' | 'other';

export interface Project {
  id: string;
  name: string;
  type: ProjectType;
  fidelity: Fidelity;
  designSystemId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectRequest {
  name: string;
  type: ProjectType;
  fidelity: Fidelity;
  designSystemId?: string;
  // First user prompt; if present, kicks off generation immediately.
  initialPrompt?: string;
}

export interface UpdateProjectRequest {
  name?: string;
}

export interface ListProjectsResponse {
  projects: Project[];
}
