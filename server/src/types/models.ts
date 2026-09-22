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
