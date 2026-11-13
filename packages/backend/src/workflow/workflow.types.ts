export interface WorkflowStepSeed {
  state: string;
  label: string;
  sortOrder: number;
  isMandatory?: boolean;
  permissions?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any;
}
