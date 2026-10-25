# Anexo UML para complementar la retroalimentacion del Taller 2

Se adjuntan dos diagramas como complemento visual al Taller 3. Aunque la guia del Taller 3 solicita inventario de endpoints, implementacion, coleccion de pruebas y README, este anexo atiende expresamente la observacion del profesor sobre los diagramas del Taller 2.

## Diagrama de secuencia

Archivo: `diagrama_secuencia_servix.svg` (vectorial editable) y `diagrama_secuencia_servix.png` (imagen para documentos).

La notacion emplea participantes en cabeceras, lineas de vida verticales discontinuas, llamadas con linea continua y respuestas con linea discontinua. El flujo representa la busqueda, postulacion, validacion, persistencia en RAM y aceptacion del trabajador. Las operaciones nombradas concuerdan con las rutas REST implementadas.

## Diagrama de actividad

Archivo: `diagrama_actividad_servix.svg` (vectorial editable) y `diagrama_actividad_servix.png` (imagen para documentos).

El proceso se divide en tres carriles horizontales claramente delimitados: Solicitante, Sistema SERVIX y Trabajador. Todas las acciones estan contenidas dentro de su carril; las flechas muestran los intercambios entre participantes. Los rombos representan decisiones y las ramas muestran el tratamiento de datos invalidos y de una oferta no aceptada.

## Alcance

Los diagramas describen el flujo principal y no implican que existan componentes externos no implementados. El almacenamiento representado es RAM; las notificaciones son internas; el pago se mantiene simulado.
