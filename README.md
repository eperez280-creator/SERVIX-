# SERVIX - API REST (Taller 3)

**Asignatura:** Construccion de Software  
**Proyecto:** SERVIX  
**Tecnologia:** Node.js + TypeScript, API REST, almacenamiento en memoria (RAM)  
**Version de la API:** `v1`  

## 1. Objetivo y alcance

Este proyecto implementa una API REST para el prototipo academico SERVIX. La aplicacion conecta personas que necesitan realizar un trabajo puntual con personas que ofrecen sus conocimientos en oficios. Se conserva una sola cuenta por persona: segun la accion, el usuario puede actuar como solicitante o como trabajador.

El servidor permite registrar e iniciar sesion, publicar y consultar servicios, postularse, aceptar a un trabajador, intercambiar mensajes, simular un pago, marcar la finalizacion, calificar, consultar historial, crear PQRS y consultar notificaciones internas.

**Importante:** los datos se guardan en arrays y mapas en memoria. Al reiniciar el servidor, se eliminan las cuentas, sesiones y demas registros. El prototipo no sustituye una base de datos ni un servicio real de pagos, archivos, push o correo electronico.

## 2. Requisitos previos

- Node.js 20 o superior.
- npm.
- Postman (para ejecutar la coleccion incluida).

## 3. Instalacion y ejecucion

Desde la carpeta del proyecto:

```bash
npm install
npm run dev
```

El servidor queda disponible en `http://localhost:3000`. Para comprobar que esta activo, abre otra terminal y ejecuta:

```bash
curl http://localhost:3000/api/v1/health
```

Para compilar TypeScript y ejecutar la version compilada:

```bash
npm run check
npm run build
npm start
```

Puedes cambiar el puerto con la variable de entorno `PORT`, por ejemplo `PORT=3100 npm run dev`.

## 4. Dependencias

- `typescript`: compilacion y verificacion de tipos.
- `tsx`: ejecucion del codigo TypeScript en desarrollo.
- `@types/node`: definiciones de tipos para las APIs integradas de Node.js.

No se usa una base de datos ni dependencias de terceros en tiempo de ejecucion; el servidor HTTP, la creacion de IDs y el hash de contrasenas usan modulos integrados de Node.js.

## 5. Autenticacion y formato de las respuestas

Los endpoints protegidos reciben:

```http
Authorization: Bearer <token>
Content-Type: application/json
```

`POST /api/v1/auth/register` y `POST /api/v1/auth/login` devuelven un token de prueba con una vigencia de ocho horas. En este prototipo los tokens viven en memoria y se invalidan al reiniciar el servidor.

Las respuestas exitosas tienen esta forma general:

```json
{
  "success": true,
  "data": {},
  "message": "Mensaje opcional"
}
```

Las respuestas de error tienen esta forma:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Explicacion del error",
    "details": { "campo": "Que se debe corregir" }
  }
}
```

Codigos principales: `400` solicitud incorrecta; `401` falta o invalidez del token; `403` accion no autorizada; `404` recurso o ruta inexistente; `409` conflicto con el estado del servicio; `413` cuerpo demasiado grande; `415` formato de cuerpo incorrecto; `422` datos que no pasan validaciones; `500` error inesperado.

## 6. Inventario implementado

Todos los endpoints del inventario academico se encuentran implementados en `src/server.ts`:

| Metodo | Ruta | Autenticacion | Proposito |
|---|---|---|---|
| GET | `/api/v1/health` | No | Verificar el servidor. |
| POST | `/api/v1/auth/register` | No | Registrar cuenta y abrir sesion. |
| POST | `/api/v1/auth/login` | No | Iniciar sesion. |
| POST | `/api/v1/me/verification-document` | Si | Registrar metadatos de documento; no almacena la imagen real. |
| GET | `/api/v1/services` | Si | Listar solicitudes publicadas; soporta `zona`, `categoria`, `page` y `limit`. |
| POST | `/api/v1/services` | Si | Publicar solicitud de servicio. |
| GET | `/api/v1/services/:id` | Si | Consultar detalle; la direccion de referencia solo se muestra a participantes. |
| POST | `/api/v1/services/:id/applications` | Si | Crear postulacion. |
| GET | `/api/v1/services/:id/applications` | Si, propietario | Consultar postulaciones recibidas. |
| PATCH | `/api/v1/services/:id/accept` | Si, propietario | Aceptar postulacion y cambiar estado a `EN_PROCESO`. |
| PATCH | `/api/v1/me/availability` | Si | Cambiar disponibilidad del usuario. |
| GET | `/api/v1/me/history` | Si | Consultar solicitudes creadas y trabajos asignados. |
| POST | `/api/v1/services/:id/messages` | Si, participantes | Enviar mensaje de chat. |
| GET | `/api/v1/services/:id/messages` | Si, participantes | Consultar mensajes. |
| POST | `/api/v1/services/:id/payments` | Si, solicitante | Simular pago y cambiar estado a `PAGADO`. |
| PATCH | `/api/v1/services/:id/complete` | Si, solicitante | Marcar como `COMPLETADO` despues del pago simulado. |
| POST | `/api/v1/services/:id/ratings` | Si, participantes | Registrar calificacion mutua despues de completar. |
| POST | `/api/v1/reports` | Si | Registrar reporte/PQRS en memoria. |
| PATCH | `/api/v1/services/:id/cancel` | Si, participante autorizado | Cancelar antes de completar. |
| GET | `/api/v1/me/notifications` | Si | Consultar notificaciones internas; filtro `noLeidas=true/false`. |
| PATCH | `/api/v1/me/notifications/:notificationId/read` | Si, propietario | Marcar notificacion como leida. |

## 7. Ejemplos cURL

### 7.1 Registro

```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"nombreCompleto":"Ana Torres","correoElectronico":"ana.demo@servix.test","telefono":"3001234567","contrasena":"ServixDemo2026!"}'
```

Guarda el `data.token` de la respuesta. El ejemplo es reutilizable solo si el correo no existe en la memoria actual; puedes cambiarlo al probar de nuevo.

### 7.2 Publicacion de solicitud

```bash
curl -X POST http://localhost:3000/api/v1/services \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer REEMPLAZA_CON_TOKEN' \
  -d '{"titulo":"Pintar una habitacion","descripcion":"Pintar una habitacion de 12 metros cuadrados.","categoria":"Pintura","precio":180000,"fecha":"2027-12-01","hora":"09:00","ciudad":"Bogota","zona":"Suba"}'
```

### 7.3 Listado por zona

```bash
curl 'http://localhost:3000/api/v1/services?zona=Suba&categoria=Pintura&page=1&limit=10' \
  -H 'Authorization: Bearer REEMPLAZA_CON_TOKEN'
```

### 7.4 Postulacion

```bash
curl -X POST http://localhost:3000/api/v1/services/ID_SOLICITUD/applications \
  -H 'Authorization: Bearer TOKEN_TRABAJADOR'
```

No requiere cuerpo JSON. El trabajador debe tener `disponible: true`.

## 8. Coleccion de Postman

Archivo: `postman/SERVIX_API_Taller_3.postman_collection.json`.

1. Inicia la API con `npm run dev`.
2. En Postman, selecciona **Import** y elige el JSON de la coleccion.
3. Confirma que la variable `baseUrl` sea `http://localhost:3000`.
4. Ejecuta las solicitudes en orden, desde `01 - Health` hasta el final. La coleccion genera correos nuevos de demostracion y guarda tokens, ID de solicitud, postulacion y notificacion automaticamente.
5. La solicitud de cancelacion al final es una prueba negativa intencional: espera HTTP `409`, porque el servicio ya esta completado.

Si ejecutas una peticion aislada, primero debes haber realizado los pasos que crean las variables que necesita.

## 9. Seguridad y limitaciones

- Las contrasenas no se devuelven en las respuestas y se almacenan como hash derivado con `scrypt` y sal aleatoria, no en texto plano.
- Los tokens son aleatorios, tienen ocho horas de vigencia y desaparecen al reiniciar el servidor.
- Se limita el tamano del cuerpo JSON a 100 KB y se validan tipos, longitudes, rangos, fecha, hora y estados del negocio.
- La direccion de referencia no se devuelve a usuarios ajenos al servicio.
- Los datos son transitorios y no existen recuperacion, auditoria persistente ni controles administrativos completos.
- El endpoint del documento solo registra nombre, tipo y tamano; no recibe los bytes del archivo ni realiza verificacion humana automatizada.
- Las notificaciones son registros internos en memoria. No hay notificaciones push, SMS ni correo.
- El endpoint de pago solo admite el numero sintetico `4242424242424242`, valida fecha/CVV con reglas de prueba, guarda solo los ultimos cuatro digitos y nunca realiza cobros. **No introduzcas datos de tarjetas reales.** En una aplicacion real debe utilizarse una pasarela certificada y tokens del proveedor; el servidor no debe recibir ni almacenar el CVV.
- No es un sistema listo para produccion. Antes de desplegarlo se requieren base de datos, HTTPS, gestion robusta de sesiones, rate limiting, controles de abuso, carga segura de documentos, autorizacion administrativa y una pasarela real.

## 10. Relacion con los requisitos del Taller 2

- **RF01:** registro e inicio de sesion.
- **RF02:** registro simulado de metadatos del documento, pendiente de verificacion.
- **RF03-RF07:** publicar, definir tarifa, programar fecha/hora, indicar zona y filtrar trabajos.
- **RF08:** postularse, aceptar trabajador, cambiar el estado y generar notificaciones internas.
- **RF09:** chat de texto asociado a una solicitud activa.
- **RF10:** disponibilidad para controlar si un usuario puede postularse.
- **RF11:** pago de prueba sin cobro real.
- **RF12:** calificacion mutua y actualizacion del promedio.
- **RF13:** registro de PQRS.
- **RF14:** historial unificado por solicitante y trabajador.
- **RF15:** cancelacion permitida solo en estados previos a la finalizacion.

Esta implementacion representa un MVP academico en memoria. El alcance se mantiene explicito: no se afirma que existan pasarela real, almacenamiento persistente, archivos reales ni notificaciones externas.
