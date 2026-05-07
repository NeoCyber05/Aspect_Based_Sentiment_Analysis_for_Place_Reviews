const apiBase = import.meta.env.VITE_API_BASE_URL || "http://localhost:8090";

async function toJSON(response) {
  if (response.status === 204) return null;

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || "Yêu cầu thất bại");
  }

  return data;
}

export async function fetchJobs() {
  const response = await fetch(`${apiBase}/api/v1/jobs`);
  return toJSON(response);
}

export async function createJob(payload) {
  const response = await fetch(`${apiBase}/api/v1/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  return toJSON(response);
}

export async function deleteJob(id) {
  const response = await fetch(`${apiBase}/api/v1/jobs/${id}`, {
    method: "DELETE"
  });
  return toJSON(response);
}

export function downloadJobCsv(id) {
  window.open(`${apiBase}/api/v1/jobs/${id}/download`, "_blank", "noopener,noreferrer");
}
