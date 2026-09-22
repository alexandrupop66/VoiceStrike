export type Job = {
  id: string;
  worker_id: string;
  station: string;
  expected_component: string;
  status: string;
};

export type InventoryItem = {
  component: string;
  location: string;
  quantity: number;
};

export type ExceptionRecord = {
  id: string;
  job_id: string;
  type: string;
  description: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
};


export type ActionRecord = {
  id: string;
  job_id: string;
  type: string;
  payload: string | null;
  timestamp: string;
  reversible: number;
  reversed: number;
};

export type AuditRecord = {
  id: number;
  timestamp: string;
  actor: string;
  event: string;
  before_state: string | null;
  after_state: string | null;
};

export type DashboardState = {
  job: Job;
  inventory: InventoryItem[];
  alternatives: InventoryItem[];
  exceptions: ExceptionRecord[];
  actions: ActionRecord[];
  audit: AuditRecord[];
};
