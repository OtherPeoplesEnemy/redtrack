import axios from 'axios'

// All requests go through Nginx at /api/
const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    if (error.response?.status === 401) {
      const refresh = localStorage.getItem('refresh_token')
      if (refresh) {
        try {
          const { data } = await axios.post('/api/auth/refresh', { refresh_token: refresh })
          localStorage.setItem('access_token', data.access_token)
          localStorage.setItem('refresh_token', data.refresh_token)
          error.config.headers.Authorization = `Bearer ${data.access_token}`
          return api.request(error.config)
        } catch {
          localStorage.clear()
          window.location.href = '/login'
        }
      }
    }
    return Promise.reject(error)
  }
)

export const authApi = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  register: (data) => api.post('/auth/register', data),
  me: () => api.get('/auth/me'),
  refresh: (refresh_token) => api.post('/auth/refresh', { refresh_token }),
  generateApiKey: () => api.post('/auth/api-key'),
}

export const reportDashboardApi = {
  get: (engId) => api.get(`/engagements/${engId}/report-dashboard`),
  save: (engId, data) => api.put(`/engagements/${engId}/report-dashboard`, data),
}

export const notesApi = {
  list: (engId) => api.get(`/engagements/${engId}/notes`),
  create: (engId, data) => api.post(`/engagements/${engId}/notes`, data),
  update: (noteId, data) => api.patch(`/notes/${noteId}`, data),
  remove: (noteId) => api.delete(`/notes/${noteId}`),
}

export const tokensApi = {
  list: () => api.get('/auth/tokens'),
  create: (name) => api.post('/auth/tokens', { name }),
  revoke: (id) => api.delete(`/auth/tokens/${id}`),
}

export const ssoApi = {
  status: () => api.get('/auth/sso/status'),
  exchange: (code) => api.post('/auth/sso/exchange', { code }),
  adminGet: () => api.get('/admin/sso'),
  saveSaml: (data) => api.put('/admin/sso/saml', data),
  saveOidc: (data) => api.put('/admin/sso/oidc', data),
  samlLoginUrl: () => '/api/auth/sso/saml/login',
  oidcLoginUrl: () => '/api/auth/sso/oidc/login',
}

export const dashboardApi = {
  stats: () => api.get('/dashboard/stats'),
}

export const engagementsApi = {
  list: (params) => api.get('/engagements/', { params }),
  get: (id) => api.get(`/engagements/${id}`),
  create: (data) => api.post('/engagements/', data),
  update: (id, data) => api.patch(`/engagements/${id}`, data),
  delete: (id) => api.delete(`/engagements/${id}`),
  updateStatus: (id, status) => api.patch(`/engagements/${id}`, { status }),
}

export const findingsApi = {
  list: (params) => api.get('/findings/', { params }),
  get: (id) => api.get(`/findings/${id}`),
  create: (engagementId, data) => api.post(`/findings/${engagementId}`, data),
  update: (id, data) => api.patch(`/findings/${id}`, data),
  delete: (id) => api.delete(`/findings/${id}`),
  uploadEvidence: (findingId, formData) =>
    api.post(`/findings/${findingId}/evidence`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  listEvidence: (findingId) => api.get(`/findings/${findingId}/evidence`),
  addComment: (findingId, data) => api.post(`/findings/${findingId}/comments`, data),
  listComments: (findingId) => api.get(`/findings/${findingId}/comments`),
}

export const reconApi = {
  listHosts: (engagementId) => api.get(`/recon/${engagementId}/hosts`),
  addHost: (engagementId, data) => api.post(`/recon/${engagementId}/hosts`, data),
  deleteHost: (hostId) => api.delete(`/recon/hosts/${hostId}`),
}

export const reportsApi = {
  create: (engagementId, data) => api.post(`/reports/${engagementId}`, data),
  generate: (reportId) => api.post(`/reports/${reportId}/generate`),
  download: (reportId) => api.get(`/reports/${reportId}/download`, { responseType: 'blob' }),
  listByEngagement: (engagementId) => api.get(`/reports/engagement/${engagementId}`),
}

export const aiApi = {
  analyze: (findingId) => api.post('/ai/analyze', { finding_id: findingId }),
  remediation: (data) => api.post('/ai/remediation', data),
  executiveSummary: (engagementId) => api.post('/ai/executive-summary', { engagement_id: engagementId }),
  steps: (title, description, affectedComponent) =>
    api.post('/ai/steps', null, { params: { title, description, affected_component: affectedComponent } }),
  cvss: (title, description) => api.post('/ai/cvss', null, { params: { title, description } }),
  chat: (messages, engagementId, findingId, isAiRedteam) =>
    api.post('/ai/chat', { messages, engagement_id: engagementId, finding_id: findingId, is_ai_redteam: isAiRedteam }),
  analyzePhase: (phase, context) => api.post('/ai/redteam-phase', { phase, context }),
  provider: () => api.get('/ai/provider'),
}

export const vulnsApi = {
  list: (params) => api.get('/vulns/', { params }),
  import: (templateId, engagementId) => api.post(`/vulns/${templateId}/import/${engagementId}`),
}

export const mitreApi = {
  getPhases: (engagementId) => api.get(`/mitre/${engagementId}/phases`),
  updatePhase: (phaseId, data) => api.patch(`/mitre/phases/${phaseId}`, data),
  initPhases: (engagementId, framework) => api.post(`/mitre/${engagementId}/init`, { framework }),
}

export function createEngagementSocket(engagementId, onMessage) {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${protocol}://${window.location.host}/ws/${engagementId}`)
  ws.onmessage = (e) => onMessage(JSON.parse(e.data))
  return ws
}

export default api
