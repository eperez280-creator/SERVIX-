import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * SERVIX API - Taller 3
 * Prototipo academico REST con Node.js + TypeScript y almacenamiento en memoria.
 * No usar para produccion: tokens y datos se pierden al reiniciar el servidor.
 */

const PORT = Number(process.env.PORT ?? 3000);
const API_PREFIX = '/api/v1';
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 100 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DEMO_TEST_CARD = '4242424242424242';

 type ServiceState = 'PUBLICADO' | 'EN_PROCESO' | 'PAGADO' | 'COMPLETADO' | 'CANCELADO';
 type VerificationState = 'PENDIENTE' | 'VERIFICADO' | 'RECHAZADO';
 type ApplicationState = 'PENDIENTE' | 'ACEPTADA' | 'RECHAZADA';
 type PaymentState = 'APROBADO';

interface User {
  id: string;
  nombreCompleto: string;
  correoElectronico: string;
  telefono: string;
  passwordSalt: string;
  passwordHash: string;
  estadoVerificacion: VerificationState;
  documentoVerificacion?: { nombreArchivo: string; mimeType: 'image/jpeg' | 'image/png'; tamanoBytes: number; fechaEnvio: string };
  disponible: boolean;
  reputacionPromedio: number;
  totalCalificaciones: number;
  createdAt: string;
}

interface Session {
  userId: string;
  expiresAt: number;
}

interface ServiceRequest {
  id: string;
  solicitanteId: string;
  titulo: string;
  descripcion: string;
  categoria: string;
  precio: number;
  fecha: string;
  hora: string;
  ciudad: string;
  zona: string;
  direccionReferencia?: string;
  estado: ServiceState;
  trabajadorAceptadoId?: string;
  createdAt: string;
  updatedAt: string;
}

interface Application {
  id: string;
  solicitudId: string;
  trabajadorId: string;
  estado: ApplicationState;
  createdAt: string;
  updatedAt: string;
}

interface ChatMessage {
  id: string;
  solicitudId: string;
  remitenteId: string;
  texto: string;
  createdAt: string;
}

interface Payment {
  id: string;
  solicitudId: string;
  solicitanteId: string;
  monto: number;
  estado: PaymentState;
  modo: 'SIMULADO';
  ultimos4: string;
  referencia: string;
  createdAt: string;
}

interface Rating {
  id: string;
  solicitudId: string;
  evaluadorId: string;
  evaluadoId: string;
  estrellas: number;
  comentario: string;
  createdAt: string;
}

interface Report {
  id: string;
  usuarioId: string;
  asunto: string;
  mensaje: string;
  estado: 'RECIBIDO' | 'EN_REVISION' | 'CERRADO';
  createdAt: string;
}

interface Notification {
  id: string;
  usuarioId: string;
  tipo: string;
  mensaje: string;
  solicitudId?: string;
  leida: boolean;
  createdAt: string;
}

interface ApiErrorShape {
  code: string;
  message: string;
  details?: Record<string, string>;
}

class ApiError extends Error {
  status: number;
  code: string;
  details?: Record<string, string>;

  constructor(status: number, code: string, message: string, details?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: string[];
  user?: User;
}

type Handler = (context: RequestContext) => void | Promise<void>;
interface Route {
  method: string;
  pattern: RegExp;
  requiresAuth: boolean;
  handler: Handler;
}

// Todos los almacenes siguientes viven solo en RAM. Se reinician al parar el proceso.
const users = new Map<string, User>();
const sessions = new Map<string, Session>();
const serviceRequests = new Map<string, ServiceRequest>();
const applications = new Map<string, Application>();
const messages: ChatMessage[] = [];
const payments: Payment[] = [];
const ratings: Rating[] = [];
const reports: Report[] = [];
const notifications: Notification[] = [];
const routes: Route[] = [];

function nowIso(): string {
  return new Date().toISOString();
}

function registerRoute(method: string, pattern: RegExp, requiresAuth: boolean, handler: Handler): void {
  routes.push({ method, pattern, requiresAuth, handler });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload, null, 2));
}

function sendSuccess(res: ServerResponse, status: number, data: unknown, message?: string): void {
  sendJson(res, status, { success: true, data, ...(message ? { message } : {}) });
}

function sendFailure(res: ServerResponse, status: number, error: ApiErrorShape): void {
  sendJson(res, status, { success: false, error });
}

function getUser(context: RequestContext): User {
  if (!context.user) throw new ApiError(401, 'UNAUTHORIZED', 'Se requiere autenticacion mediante token Bearer.');
  return context.user;
}

function authenticate(req: IncomingMessage): User {
  const header = req.headers.authorization;
  if (!header) throw new ApiError(401, 'TOKEN_REQUIRED', 'Envia el encabezado Authorization: Bearer <token>.');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new ApiError(401, 'INVALID_AUTH_HEADER', 'El encabezado Authorization no tiene el formato Bearer.');
  const token = match[1].trim();
  const session = sessions.get(token);
  if (!session) throw new ApiError(401, 'INVALID_TOKEN', 'El token no existe o la sesion ya no esta activa.');
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    throw new ApiError(401, 'TOKEN_EXPIRED', 'La sesion expiro. Inicia sesion de nuevo.');
  }
  const user = users.get(session.userId);
  if (!user) throw new ApiError(401, 'INVALID_SESSION_USER', 'La cuenta de esta sesion ya no esta disponible.');
  return user;
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
  if (!contentType.includes('application/json')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Este endpoint recibe un cuerpo JSON con Content-Type: application/json.');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'El cuerpo supera el limite de 100 KB.');
    chunks.push(buffer);
  }
  if (size === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'El cuerpo de la solicitud no contiene JSON valido.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(400, 'INVALID_BODY', 'El cuerpo debe ser un objeto JSON.');
  }
  return parsed as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, field: string, min: number, max: number): string {
  const value = body[field];
  if (typeof value !== 'string') {
    throw new ApiError(422, 'VALIDATION_ERROR', `El campo '${field}' es obligatorio y debe ser texto.`, { [field]: 'Debe ser texto.' });
  }
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new ApiError(422, 'VALIDATION_ERROR', `El campo '${field}' debe tener entre ${min} y ${max} caracteres.`, { [field]: `Longitud permitida: ${min}-${max}.` });
  }
  return normalized;
}

function optionalString(body: Record<string, unknown>, field: string, max: number): string | undefined {
  const value = body[field];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.trim().length > max) {
    throw new ApiError(422, 'VALIDATION_ERROR', `El campo '${field}' debe ser texto de maximo ${max} caracteres.`, { [field]: `Maximo ${max} caracteres.` });
  }
  return value.trim();
}

function requiredNumber(body: Record<string, unknown>, field: string, min: number, max: number): number {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new ApiError(422, 'VALIDATION_ERROR', `El campo '${field}' debe ser un numero entre ${min} y ${max}.`, { [field]: `Rango permitido: ${min}-${max}.` });
  }
  return value;
}

function requiredBoolean(body: Record<string, unknown>, field: string): boolean {
  const value = body[field];
  if (typeof value !== 'boolean') {
    throw new ApiError(422, 'VALIDATION_ERROR', `El campo '${field}' debe ser true o false.`, { [field]: 'Debe ser booleano.' });
  }
  return value;
}

function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function passwordMatches(password: string, salt: string, savedHash: string): boolean {
  const calculated = scryptSync(password, salt, 64);
  const saved = Buffer.from(savedHash, 'hex');
  return calculated.length === saved.length && timingSafeEqual(calculated, saved);
}

function createSession(userId: string): { token: string; expiresInSeconds: number } {
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { userId, expiresAt: Date.now() + SESSION_LIFETIME_MS });
  return { token, expiresInSeconds: Math.floor(SESSION_LIFETIME_MS / 1000) };
}

function privateUserDto(user: User): Record<string, unknown> {
  return {
    id: user.id,
    nombreCompleto: user.nombreCompleto,
    correoElectronico: user.correoElectronico,
    telefono: user.telefono,
    estadoVerificacion: user.estadoVerificacion,
    disponible: user.disponible,
    reputacionPromedio: user.reputacionPromedio,
    totalCalificaciones: user.totalCalificaciones,
    ...(user.documentoVerificacion ? { documentoVerificacion: { ...user.documentoVerificacion } } : {}),
    createdAt: user.createdAt,
  };
}

function publicUserDto(user: User | undefined): Record<string, unknown> | null {
  if (!user) return null;
  return {
    id: user.id,
    nombreCompleto: user.nombreCompleto,
    estadoVerificacion: user.estadoVerificacion,
    disponible: user.disponible,
    reputacionPromedio: user.reputacionPromedio,
    totalCalificaciones: user.totalCalificaciones,
  };
}

function serviceDto(service: ServiceRequest, viewerId: string): Record<string, unknown> {
  const isParticipant = service.solicitanteId === viewerId || service.trabajadorAceptadoId === viewerId;
  return {
    id: service.id,
    solicitanteId: service.solicitanteId,
    titulo: service.titulo,
    descripcion: service.descripcion,
    categoria: service.categoria,
    precio: service.precio,
    fecha: service.fecha,
    hora: service.hora,
    ciudad: service.ciudad,
    zona: service.zona,
    ...(isParticipant && service.direccionReferencia ? { direccionReferencia: service.direccionReferencia } : {}),
    estado: service.estado,
    ...(service.trabajadorAceptadoId ? { trabajadorAceptadoId: service.trabajadorAceptadoId } : {}),
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  };
}

function notify(usuarioId: string, tipo: string, mensaje: string, solicitudId?: string): void {
  notifications.push({ id: randomUUID(), usuarioId, tipo, mensaje, ...(solicitudId ? { solicitudId } : {}), leida: false, createdAt: nowIso() });
}

function isParticipant(service: ServiceRequest, userId: string): boolean {
  return service.solicitanteId === userId || service.trabajadorAceptadoId === userId;
}

function getServiceOrThrow(id: string): ServiceRequest {
  const service = serviceRequests.get(id);
  if (!service) throw new ApiError(404, 'SERVICE_NOT_FOUND', 'No se encontro la solicitud de servicio indicada.');
  return service;
}

function parsePage(value: string | null, fallback: number, name: string, max: number): number {
  if (value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new ApiError(400, 'INVALID_QUERY_PARAM', `El parametro '${name}' debe ser un entero entre 1 y ${max}.`, { [name]: `Rango permitido: 1-${max}.` });
  }
  return parsed;
}

function normalizedContains(value: string, search: string | null): boolean {
  return !search || value.toLocaleLowerCase('es-CO').includes(search.trim().toLocaleLowerCase('es-CO'));
}

function expirationIsValid(value: string): boolean {
  const match = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  const now = new Date();
  return year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1);
}

// 1. Estado del servicio (publico).
registerRoute('GET', new RegExp(`^${API_PREFIX}/health$`), false, ({ res }) => {
  sendSuccess(res, 200, { status: 'ok', servicio: 'SERVIX API', version: '1.0.0', almacenamiento: 'memoria RAM' }, 'Servidor disponible.');
});

// 2. Crear una cuenta y una sesion inicial.
registerRoute('POST', new RegExp(`^${API_PREFIX}/auth/register$`), false, async (context) => {
  const body = await readJsonBody(context.req);
  const nombreCompleto = requiredString(body, 'nombreCompleto', 3, 100);
  const correoElectronico = requiredString(body, 'correoElectronico', 6, 160).toLowerCase();
  const telefono = requiredString(body, 'telefono', 7, 20);
  const contrasena = requiredString(body, 'contrasena', 8, 128);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correoElectronico)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'El correo electronico no tiene un formato valido.', { correoElectronico: 'Usa un correo con formato nombre@dominio.com.' });
  }
  if (users.size > 0 && [...users.values()].some((user) => user.correoElectronico === correoElectronico)) {
    throw new ApiError(409, 'EMAIL_ALREADY_REGISTERED', 'Ya existe una cuenta registrada con ese correo.');
  }
  const password = hashPassword(contrasena);
  const user: User = {
    id: randomUUID(), nombreCompleto, correoElectronico, telefono,
    passwordSalt: password.salt, passwordHash: password.hash,
    estadoVerificacion: 'PENDIENTE', disponible: false,
    reputacionPromedio: 0, totalCalificaciones: 0, createdAt: nowIso(),
  };
  users.set(user.id, user);
  const session = createSession(user.id);
  sendSuccess(context.res, 201, { usuario: privateUserDto(user), ...session }, 'Cuenta creada. El usuario puede actuar como solicitante o prestador segun la accion que realice.');
});

// 3. Inicio de sesion.
registerRoute('POST', new RegExp(`^${API_PREFIX}/auth/login$`), false, async (context) => {
  const body = await readJsonBody(context.req);
  const correoElectronico = requiredString(body, 'correoElectronico', 6, 160).toLowerCase();
  const contrasena = requiredString(body, 'contrasena', 8, 128);
  const user = [...users.values()].find((item) => item.correoElectronico === correoElectronico);
  if (!user || !passwordMatches(contrasena, user.passwordSalt, user.passwordHash)) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Correo o contrasena incorrectos.');
  }
  sendSuccess(context.res, 200, { usuario: privateUserDto(user), ...createSession(user.id) }, 'Inicio de sesion exitoso.');
});

// 4. Registrar metadatos del documento de verificacion. No se almacenan bytes de imagen.
registerRoute('POST', new RegExp(`^${API_PREFIX}/me/verification-document$`), true, async (context) => {
  const user = getUser(context);
  const body = await readJsonBody(context.req);
  const nombreArchivo = requiredString(body, 'nombreArchivo', 1, 120);
  const mimeType = requiredString(body, 'mimeType', 9, 30);
  const tamanoBytes = requiredNumber(body, 'tamanoBytes', 1, MAX_IMAGE_BYTES);
  if (!['image/jpeg', 'image/png'].includes(mimeType)) {
    throw new ApiError(422, 'INVALID_IMAGE_TYPE', 'El documento debe ser una imagen JPG/JPEG o PNG.', { mimeType: 'Tipos permitidos: image/jpeg, image/png.' });
  }
  user.documentoVerificacion = { nombreArchivo, mimeType: mimeType as 'image/jpeg' | 'image/png', tamanoBytes, fechaEnvio: nowIso() };
  user.estadoVerificacion = 'PENDIENTE';
  sendSuccess(context.res, 201, { usuario: privateUserDto(user), aviso: 'Solo se guardo la metadata del archivo; no se recibio ni guardo la imagen real.' }, 'Documento registrado para revision manual/simulada.');
});

// 5. Explorar solicitudes publicadas con filtros y paginacion.
registerRoute('GET', new RegExp(`^${API_PREFIX}/services$`), true, (context) => {
  const user = getUser(context);
  const zona = context.url.searchParams.get('zona');
  const categoria = context.url.searchParams.get('categoria');
  const page = parsePage(context.url.searchParams.get('page'), 1, 'page', 1000000);
  const limit = parsePage(context.url.searchParams.get('limit'), 10, 'limit', 100);
  const filtered = [...serviceRequests.values()]
    .filter((service) => service.estado === 'PUBLICADO')
    .filter((service) => normalizedContains(service.zona, zona))
    .filter((service) => normalizedContains(service.categoria, categoria))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const start = (page - 1) * limit;
  sendSuccess(context.res, 200, { items: filtered.slice(start, start + limit).map((service) => serviceDto(service, user.id)), pagination: { page, limit, total: filtered.length, totalPages: Math.ceil(filtered.length / limit) } });
});

// 6. Publicar una nueva solicitud.
registerRoute('POST', new RegExp(`^${API_PREFIX}/services$`), true, async (context) => {
  const user = getUser(context);
  const body = await readJsonBody(context.req);
  const titulo = requiredString(body, 'titulo', 5, 100);
  const descripcion = requiredString(body, 'descripcion', 10, 2000);
  const categoria = requiredString(body, 'categoria', 2, 60);
  const precio = requiredNumber(body, 'precio', 1, 100000000);
  const fecha = requiredString(body, 'fecha', 10, 10);
  const hora = requiredString(body, 'hora', 5, 5);
  const ciudad = requiredString(body, 'ciudad', 2, 80);
  const zona = requiredString(body, 'zona', 2, 100);
  const direccionReferencia = optionalString(body, 'direccionReferencia', 200);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(`${fecha}T12:00:00Z`))) {
    throw new ApiError(422, 'INVALID_DATE', 'La fecha debe tener el formato YYYY-MM-DD.', { fecha: 'Ejemplo: 2027-12-01.' });
  }
  if (fecha < new Date().toISOString().slice(0, 10)) {
    throw new ApiError(422, 'PAST_DATE', 'La fecha del servicio no puede estar en el pasado.', { fecha: 'Elige la fecha actual o una futura.' });
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) {
    throw new ApiError(422, 'INVALID_TIME', 'La hora debe estar en formato 24 horas HH:mm.', { hora: 'Ejemplo: 14:30.' });
  }
  const service: ServiceRequest = {
    id: randomUUID(), solicitanteId: user.id, titulo, descripcion, categoria,
    precio: Math.round(precio * 100) / 100, fecha, hora, ciudad, zona,
    ...(direccionReferencia ? { direccionReferencia } : {}), estado: 'PUBLICADO',
    createdAt: nowIso(), updatedAt: nowIso(),
  };
  serviceRequests.set(service.id, service);
  sendSuccess(context.res, 201, { solicitud: serviceDto(service, user.id) }, 'Solicitud publicada y disponible para postulaciones.');
});

// 7. Consultar el detalle de una solicitud. La direccion se oculta a terceros.
registerRoute('GET', new RegExp(`^${API_PREFIX}/services/([^/]+)$`), true, (context) => {
  const user = getUser(context);
  const service = getServiceOrThrow(context.params[0]);
  sendSuccess(context.res, 200, { solicitud: serviceDto(service, user.id) });
});

// 8. Postularse a una solicitud publicada.
registerRoute('POST', new RegExp(`^${API_PREFIX}/services/([^/]+)/applications$`), true, (context) => {
  const user = getUser(context);
  const service = getServiceOrThrow(context.params[0]);
  if (service.solicitanteId === user.id) throw new ApiError(409, 'OWNER_CANNOT_APPLY', 'No puedes postularte a una solicitud que publicaste.');
  if (!user.disponible) throw new ApiError(409, 'WORKER_NOT_AVAILABLE', 'Activa tu disponibilidad antes de postularte.');
  if (service.estado !== 'PUBLICADO') throw new ApiError(409, 'SERVICE_NOT_OPEN', 'Solo puedes postularte a solicitudes en estado PUBLICADO.');
  const existing = [...applications.values()].find((item) => item.solicitudId === service.id && item.trabajadorId === user.id);
  if (existing) throw new ApiError(409, 'APPLICATION_ALREADY_EXISTS', 'Ya te postulaste a esta solicitud.');
  const application: Application = { id: randomUUID(), solicitudId: service.id, trabajadorId: user.id, estado: 'PENDIENTE', createdAt: nowIso(), updatedAt: nowIso() };
  applications.set(application.id, application);
  notify(service.solicitanteId, 'NUEVA_POSTULACION', `${user.nombreCompleto} se postulo a: ${service.titulo}.`, service.id);
  sendSuccess(context.res, 201, { postulacion: application }, 'Postulacion registrada. Se creo una notificacion interna para el solicitante.');
});

// 9. Consultar postulaciones: solo quien publico el trabajo puede verlas.
registerRoute('GET', new RegExp(`^${API_PREFIX}/services/([^/]+)/applications$`), true, (context) => {
  const user = getUser(context);
  const service = getServiceOrThrow(context.params[0]);
  if (service.solicitanteId !== user.id) throw new ApiError(403, 'FORBIDDEN', 'Solo el creador de la solicitud puede consultar las postulaciones recibidas.');
  const items = [...applications.values()]
    .filter((item) => item.solicitudId === service.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((item) => ({ ...item, trabajador: publicUserDto(users.get(item.trabajadorId)) }));
  sendSuccess(context.res, 200, { items, total: items.length });
});

// 10. Aceptar una postulacion y pasar la solicitud a EN_PROCESO.
registerRoute('PATCH', new RegExp(`^${API_PREFIX}/services/([^/]+)/accept$`), true, async (context) => {
  const user = getUser(context);
  const service = getServiceOrThrow(context.params[0]);
  const body = await readJsonBody(context.req);
  const postulacionId = requiredString(body, 'postulacionId', 1, 80);
  if (service.solicitanteId !== user.id) throw new ApiError(403, 'FORBIDDEN', 'Solo el creador de la solicitud puede aceptar a un trabajador.');
  if (service.estado !== 'PUBLICADO') throw new ApiError(409, 'SERVICE_NOT_OPEN', 'La solicitud ya no esta disponible para aceptar postulaciones.');
  const chosen = applications.get(postulacionId);
  if (!chosen || chosen.solicitudId !== service.id) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'No se encontro esa postulacion para esta solicitud.');
  if (chosen.estado !== 'PENDIENTE') throw new ApiError(409, 'APPLICATION_NOT_PENDING', 'La postulacion ya fue resuelta.');
  service.trabajadorAceptadoId = chosen.trabajadorId;
  service.estado = 'EN_PROCESO';
  service.updatedAt = nowIso();
  chosen.estado = 'ACEPTADA';
  chosen.updatedAt = nowIso();
  for (const application of applications.values()) {
    if (application.solicitudId === service.id && application.id !== chosen.id && application.estado === 'PENDIENTE') {
      application.estado = 'RECHAZADA';
      application.updatedAt = nowIso();
      notify(application.trabajadorId, 'POSTULACION_RECHAZADA', `La solicitud '${service.titulo}' fue asignada a otra persona.`, service.id);
    }
  }
  notify(service.solicitanteId, 'TRABAJADOR_ACEPTADO', `Aceptaste a un trabajador para '${service.titulo}'.`, service.id);
  notify(chosen.trabajadorId, 'POSTULACION_ACEPTADA', `Tu postulacion para '${service.titulo}' fue aceptada.`, service.id);
  sendSuccess(context.res, 200, { solicitud: serviceDto(service, user.id), postulacion: chosen }, 'Trabajador aceptado. El estado cambio a EN_PROCESO.');
});

// 11. Cambiar disponibilidad para postularse a trabajos.
registerRoute('PATCH', new RegExp(`^${API_PREFIX}/me/availability$`), true, async (context) => {
  const user = getUser(context);
  const body = await readJsonBody(context.req);
  user.disponible = requiredBoolean(body, 'disponible');
  sendSuccess(context.res, 200, { usuario: privateUserDto(user) }, `Disponibilidad actualizada: ${user.disponible ? 'Disponible' : 'No disponible'}.`);
});

// 12. Ver historial unificado de solicitudes y trabajos prestados.
registerRoute('GET', new RegExp(`^${API_PREFIX}/me/history$`), true, (context) => {
  const user = getUser(context);
  const solicitudes = [...serviceRequests.values()].filter((item) => item.solicitanteId === user.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const trabajos = [...serviceRequests.values()].filter((item) => item.trabajadorAceptadoId === user.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  sendSuccess(context.res, 200, {
    solicitudesComoSolicitante: solicitudes.map((item) => serviceDto(item, user.id)),
    trabajosComoTrabajador: trabajos.map((item) => serviceDto(item, user.id)),
    resumen: { solicitudesCreadas: solicitudes.length, trabajosAsignados: trabajos.length },
  });
});

// 13. Enviar un mensaje al chat del servicio activo.
registerRoute('POST', new RegExp(`^${API_PREFIX}/services/([^/]+)/messages$`), true, async (context) => {
  const user = getUser(context);
  const service = getServiceOrThrow(context.params[0]);
  const body = await readJsonBody(context.req);
  const texto = requiredString(body, 'texto', 1, 2000);
  if (!isParticipant(service, user.id)) throw new ApiError(403, 'FORBIDDEN', 'Solo los participantes del servicio pueden usar este chat.');
  if (!['EN_PROCESO', 'PAGADO'].includes(service.estado)) throw new ApiError(409, 'CHAT_NOT_ACTIVE', 'El chat solo esta disponible mientras el servicio esta EN_PROCESO o PAGADO.');
  const message: ChatMessage = { id: randomUUID(), solicitudId: service.id, remitenteId: user.id, texto, createdAt: nowIso() };
  messages.push(message);
  sendSuccess(context.res, 201, { mensaje: message }, 'Mensaje agregado al historial del chat.');
});

// 14. Leer mensajes: solo participantes.
registerRoute('GET', new RegExp(`^${API_PREFIX}/services/([^/]+)/messages$`), true, (context) => {
  const user = getUser(context);
  const service = getServiceOrThrow(context.params[0]);
  if (!isParticipant(service, user.id)) throw new ApiError(403, 'FORBIDDEN', 'Solo los participantes del servicio pueden consultar el chat.');
  const items = messages.filter((message) => message.solicitudId === service.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  sendSuccess(context.res, 200, { items, total: items.length });
});

// 15. Pago de prueba. Solo acepta una tarjeta sintetica conocida y nunca hace cargos.
registerRoute('POST', new RegExp(`^${API_PREFIX}/services/([^/]+)/payments$`), true, async (context) => {
  const user = getUser(context);
  const service = getServiceOrThrow(context.params[0]);
  const body = await readJsonBody(context.req);
  const numeroTarjetaPrueba = requiredString(body, 'numeroTarjetaPrueba', 16, 19);
  const fechaExpiracionPrueba = requiredString(body, 'fechaExpiracionPrueba', 5, 5);
  const cvvPrueba = requiredString(body, 'cvvPrueba', 3, 4);
  if (service.solicitanteId !== user.id) throw new ApiError(403, 'FORBIDDEN', 'Solo quien solicito el servicio puede registrar su pago de prueba.');
  if (service.estado !== 'EN_PROCESO') throw new ApiError(409, 'PAYMENT_NOT_ALLOWED', 'El pago solo puede simularse cuando el servicio esta EN_PROCESO.');
  if (numeroTarjetaPrueba !== DEMO_TEST_CARD) {
    throw new ApiError(422, 'TEST_CARD_ONLY', `Para evitar el uso de datos reales, usa exclusivamente la tarjeta de prueba ${DEMO_TEST_CARD}. No ingreses una tarjeta real.`, { numeroTarjetaPrueba: 'Usa el numero de tarjeta sintetica indicado para la prueba.' });
  }
  if (!expirationIsValid(fechaExpiracionPrueba)) throw new ApiError(422, 'INVALID_TEST_EXPIRY', 'La fecha de vencimiento de prueba debe tener formato MM/AA y no estar vencida.', { fechaExpiracionPrueba: 'Ejemplo: 12/29.' });
  if (!/^\d{3,4}$/.test(cvvPrueba)) throw new ApiError(422, 'INVALID_TEST_CVV', 'El CVV de prueba debe tener 3 o 4 digitos.', { cvvPrueba: 'Ingresa de 3 a 4 digitos ficticios.' });
  const payment: Payment = { id: randomUUID(), solicitudId: service.id, solicitanteId: user.id, monto: service.precio, estado: 'APROBADO', modo: 'SIMULADO', ultimos4: numeroTarjetaPrueba.slice(-4), referencia: `TEST-${randomUUID().slice(0, 8).toUpperCase()}`, createdAt: nowIso() };
  payments.push(payment);
  service.estado = 'PAGADO';
  service.updatedAt = nowIso();
  if (service.trabajadorAceptadoId) notify(service.trabajadorAceptadoId, 'PAGO_SIMULADO_REGISTRADO', `Se registro el pago simulado del servicio '${service.titulo}'.`, service.id);
  sendSuccess(context.res, 201, { pago: payment, solicitud: serviceDto(service, user.id), esTransaccionReal: false }, 'Pago simulado aprobado. No se realizo ningun cobro. Nunca se almacenan el numero completo ni el CVV.');
});

// 16. Confirmar que el trabajo pagado fue completado.
registerRoute('PATCH', new RegExp(`^${API_PREFIX}/services/([^/]+)/complete$`), true, (context) => {
  const user = getUser(context);
  const service = getServiceOrThrow(context.params[0]);
  if (service.solicitanteId !== user.id) throw new ApiError(403, 'FORBIDDEN', 'Solo el solicitante puede confirmar la finalizacion en este prototipo.');
  if (service.estado !== 'PAGADO') throw new ApiError(409, 'SERVICE_NOT_PAID', 'El servicio debe estar en estado PAGADO antes de marcarse como COMPLETADO.');
  service.estado = 'COMPLETADO';
  service.updatedAt = nowIso();
  if (service.trabajadorAceptadoId) notify(service.trabajadorAceptadoId, 'SERVICIO_COMPLETADO', `El servicio '${service.titulo}' fue marcado como completado y ya se puede calificar.`, service.id);
  sendSuccess(context.res, 200, { solicitud: serviceDto(service, user.id) }, 'Servicio completado. Ya se habilitan las calificaciones mutuas.');
});

// 17. Calificar a la contraparte despues de completar el servicio.
registerRoute('POST', new RegExp(`^${API_PREFIX}/services/([^/]+)/ratings$`), true, async (context) => {
  const user = getUser(context);
  const service = getServiceOrThrow(context.params[0]);
  const body = await readJsonBody(context.req);
  const estrellas = requiredNumber(body, 'estrellas', 1, 5);
  const comentario = optionalString(body, 'comentario', 1000) ?? '';
  if (!Number.isInteger(estrellas)) throw new ApiError(422, 'INVALID_RATING', 'Las estrellas deben ser un numero entero entre 1 y 5.');
  if (service.estado !== 'COMPLETADO') throw new ApiError(409, 'SERVICE_NOT_COMPLETED', 'Solo se puede calificar un servicio COMPLETADO.');
  if (!isParticipant(service, user.id) || !service.trabajadorAceptadoId) throw new ApiError(403, 'FORBIDDEN', 'Solo el solicitante y el trabajador aceptado pueden calificarse.');
  const evaluadoId = user.id === service.solicitanteId ? service.trabajadorAceptadoId : service.solicitanteId;
  if (ratings.some((rating) => rating.solicitudId === service.id && rating.evaluadorId === user.id)) {
    throw new ApiError(409, 'RATING_ALREADY_SUBMITTED', 'Cada participante puede enviar una sola calificacion por servicio.');
  }
  const rating: Rating = { id: randomUUID(), solicitudId: service.id, evaluadorId: user.id, evaluadoId, estrellas, comentario, createdAt: nowIso() };
  ratings.push(rating);
  const userRatings = ratings.filter((item) => item.evaluadoId === evaluadoId);
  const evaluatedUser = users.get(evaluadoId);
  if (evaluatedUser) {
    evaluatedUser.totalCalificaciones = userRatings.length;
    evaluatedUser.reputacionPromedio = Math.round((userRatings.reduce((sum, item) => sum + item.estrellas, 0) / userRatings.length) * 100) / 100;
  }
  notify(evaluadoId, 'NUEVA_CALIFICACION', `Recibiste una calificacion de ${estrellas} estrella(s) para el servicio '${service.titulo}'.`, service.id);
  sendSuccess(context.res, 201, { calificacion: rating, reputacionActualizada: publicUserDto(evaluatedUser) }, 'Calificacion registrada y promedio actualizado.');
});

// 18. Crear un reporte / PQRS.
registerRoute('POST', new RegExp(`^${API_PREFIX}/reports$`), true, async (context) => {
  const user = getUser(context);
  const body = await readJsonBody(context.req);
  const asunto = requiredString(body, 'asunto', 4, 120);
  const mensaje = requiredString(body, 'mensaje', 10, 3000);
  const report: Report = { id: randomUUID(), usuarioId: user.id, asunto, mensaje, estado: 'RECIBIDO', createdAt: nowIso() };
  reports.push(report);
  sendSuccess(context.res, 201, { reporte: report }, 'Reporte registrado en memoria para revision. No se envia correo externo.');
});

// 19. Cancelar una solicitud que aun no se ha completado.
registerRoute('PATCH', new RegExp(`^${API_PREFIX}/services/([^/]+)/cancel$`), true, async (context) => {
  const user = getUser(context);
  const service = getServiceOrThrow(context.params[0]);
  const body = await readJsonBody(context.req);
  const motivo = optionalString(body, 'motivo', 300);
  if (!['PUBLICADO', 'EN_PROCESO'].includes(service.estado)) {
    throw new ApiError(409, 'CANCELLATION_NOT_ALLOWED', 'Solo se pueden cancelar solicitudes PUBLICADO o EN_PROCESO.');
  }
  if (service.estado === 'PUBLICADO' && service.solicitanteId !== user.id) {
    throw new ApiError(403, 'FORBIDDEN', 'Antes de aceptar un trabajador, solo el creador puede cancelar la solicitud.');
  }
  if (service.estado === 'EN_PROCESO' && !isParticipant(service, user.id)) {
    throw new ApiError(403, 'FORBIDDEN', 'Solo los participantes del servicio pueden cancelarlo.');
  }
  const previousState = service.estado;
  service.estado = 'CANCELADO';
  service.updatedAt = nowIso();
  const otherId = user.id === service.solicitanteId ? service.trabajadorAceptadoId : service.solicitanteId;
  if (otherId) notify(otherId, 'SERVICIO_CANCELADO', `El servicio '${service.titulo}' fue cancelado.${motivo ? ` Motivo: ${motivo}` : ''}`, service.id);
  sendSuccess(context.res, 200, { solicitud: serviceDto(service, user.id), estadoAnterior: previousState, motivo: motivo ?? null }, 'Solicitud cancelada.');
});

// 20. Consultar notificaciones internas. No son push ni correo electronico.
registerRoute('GET', new RegExp(`^${API_PREFIX}/me/notifications$`), true, (context) => {
  const user = getUser(context);
  const unread = context.url.searchParams.get('noLeidas');
  if (unread !== null && !['true', 'false'].includes(unread)) throw new ApiError(400, 'INVALID_QUERY_PARAM', "El parametro 'noLeidas' debe ser true o false.");
  let items = notifications.filter((item) => item.usuarioId === user.id);
  if (unread === 'true') items = items.filter((item) => !item.leida);
  if (unread === 'false') items = items.filter((item) => item.leida);
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  sendSuccess(context.res, 200, { items, total: items.length });
});

// 21. Marcar una notificacion propia como leida.
registerRoute('PATCH', new RegExp(`^${API_PREFIX}/me/notifications/([^/]+)/read$`), true, (context) => {
  const user = getUser(context);
  const notification = notifications.find((item) => item.id === context.params[0] && item.usuarioId === user.id);
  if (!notification) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'No se encontro una notificacion de este usuario con ese identificador.');
  notification.leida = true;
  sendSuccess(context.res, 200, { notificacion: notification }, 'Notificacion marcada como leida.');
});

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const route = routes.find((item) => item.method === req.method && item.pattern.test(url.pathname));
    if (!route) throw new ApiError(404, 'ROUTE_NOT_FOUND', `No existe una ruta para ${req.method ?? 'HTTP'} ${url.pathname}.`);
    const match = route.pattern.exec(url.pathname);
    const context: RequestContext = {
      req,
      res,
      url,
      params: (match?.slice(1) ?? []).map((part) => decodeURIComponent(part)),
    };
    if (route.requiresAuth) context.user = authenticate(req);
    await route.handler(context);
  } catch (error: unknown) {
    if (res.writableEnded) return;
    if (error instanceof ApiError) {
      sendFailure(res, error.status, { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) });
      return;
    }
    console.error('Error inesperado procesando la solicitud:', error instanceof Error ? error.message : 'Error desconocido');
    sendFailure(res, 500, { code: 'INTERNAL_ERROR', message: 'Ocurrio un error inesperado. Revisa los datos enviados y vuelve a intentarlo.' });
  }
});

server.listen(PORT, () => {
  console.log(`SERVIX API escuchando en http://localhost:${PORT}${API_PREFIX}`);
  console.log('Modo academico: datos en memoria; reiniciar el servidor elimina los datos.');
});
