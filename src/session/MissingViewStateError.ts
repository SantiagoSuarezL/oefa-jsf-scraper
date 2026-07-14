export class MissingViewStateError extends Error {
  constructor(
    message = "La respuesta no contiene javax.faces.ViewState. La sesion pudo haber expirado."
  ) {
    super(message);
    this.name = "MissingViewStateError";
  }
}
