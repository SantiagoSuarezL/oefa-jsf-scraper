export interface ReadOnlyViewState {
  get(): string;
  has(): boolean;
}

export class ViewStateManager implements ReadOnlyViewState {
  private current: string | null = null;

  get(): string {
    if (this.current === null) {
      throw new Error(
        "ViewState no disponible: la sesion aun no ha sido inicializada. " +
          "Ejecuta SessionManager.init() antes de cualquier request POST."
      );
    }
    return this.current;
  }

  has(): boolean {
    return this.current !== null;
  }

  set(value: string): void {
    if (!value) {
      throw new Error("No se permite almacenar un ViewState vacio.");
    }
    this.current = value;
  }

  reset(): void {
    this.current = null;
  }
}
