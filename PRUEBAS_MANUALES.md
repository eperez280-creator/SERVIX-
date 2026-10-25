# Lista de verificacion manual de SERVIX

Ejecuta `npm run dev` antes de probar. La coleccion de Postman automatiza la mayor parte de este recorrido.

1. `GET /api/v1/health` devuelve `200`.
2. Registrar dos cuentas devuelve `201`, tokens distintos y contrasenas no visibles.
3. Intentar registrar de nuevo el mismo correo devuelve `409 EMAIL_ALREADY_REGISTERED`.
4. La publicacion con precio cero, fecha pasada o hora incorrecta devuelve `422`.
5. Sin token, un endpoint protegido devuelve `401`.
6. Una cuenta que aun no esta disponible no puede postularse (`409 WORKER_NOT_AVAILABLE`).
7. Un usuario ajeno no puede ver postulaciones o mensajes de un servicio (`403`).
8. Una postulacion duplicada devuelve `409`.
9. Al aceptar una postulacion, el servicio pasa a `EN_PROCESO` y los avisos internos se consultan en notificaciones.
10. No se permite el pago desde la cuenta del trabajador (`403`) ni con un numero de tarjeta distinto al sintetico (`422`).
11. El pago aprobado es simulado, guarda solo los ultimos cuatro digitos y cambia el estado a `PAGADO`.
12. No se permite completar el servicio antes del pago (`409`).
13. No se permite calificar antes de completar ni calificar dos veces desde el mismo participante (`409`).
14. No se permite cancelar un servicio completado (`409`).
15. Reiniciar el servidor vacia los datos; esto es parte del alcance en memoria declarado en el taller.
