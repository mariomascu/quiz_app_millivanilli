# DO NOT DEPLOY — COPIA DE PRUEBAS

Esta copia del repositorio es un entorno de pruebas. No debe desplegarse en producción bajo ninguna circunstancia.

Acciones recomendadas para evitar despliegues accidentales:

- No hacer push a remotos que apunten a producción. Comprueba con:

  git remote -v

- Elimina o mueve fuera del repositorio cualquier clave de despliegue (`opoquiz_deploy_key`, `opoquiz_deploy_key.pub`).

- Deshabilita workflows de CI/CD que desplieguen automáticamente (carpeta `.github/workflows`, integraciones de terceros).

- Renombra o elimina archivos de despliegue automáticos (`Procfile`) si confunden a otros desarrolladores o sistemas.

- Usa una rama de pruebas distinta (p. ej. `dev-local`) y trabaja siempre ahí. Nunca hagas merge a `main` desde esta copia.

- Asegura que las variables de entorno y secretos apunten a servicios de pruebas. Si la copia contiene secretos de producción, rota las credenciales en los sistemas productivos.

- Añade un banner visible en `README.md` y en la interfaz (página principal) indicando que es copia de pruebas.

- Si usas plataformas como Heroku/GitHub Actions/Netlify, verifica que no estén conectadas a este repositorio o que las integraciones estén inactivas.

Resumen de comandos útiles:

```bash
# Ver remotos
git remote -v

# Eliminar un remote (p. ej. origin)
git remote remove origin

# Crear una rama local para pruebas
git switch -c dev-local

# Ignorar claves privadas (añadir a .gitignore si procede)
echo "opoquiz_deploy_key" >> .gitignore

echo "opoquiz_deploy_key.pub" >> .gitignore
```

Si quieres, puedo:

- Eliminar/renombrar las claves detectadas en este repositorio.
- Añadir el banner en `backend/README.md` y en `public/index.html`.
- Buscar workflows CI/CD y deshabilitarlos o listarlos para que los revises.

Dime qué acciones quieres que ejecute y las hago.
