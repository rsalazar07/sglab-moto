export type EstadoTicket = 'PENDIENTE' | 'ASIGNADO' | 'EN_RUTA' | 'EN_RECOJO' | 'RECOGIDO' | 'ENTREGADO' | 'CERRADO' | 'CANCELADO' | 'FALLIDO';
export type MetodoCobro = 'EFECTIVO' | 'YAPE' | 'TRANSFERENCIA';

export interface User {
  id: string;
  email: string;
  nombre: string;
  rol: string;
  tenantId: string;
}

export interface Ticket {
  id: string;
  estado: EstadoTicket;
  prioridad: 'ALTA' | 'MEDIA' | 'BAJA';
  tipoMuestra?: string;
  tipo?: string;
  telefonoContacto?: string;
  direccionRecojo?: string;
  referencia: {
    id: string;
    nombre: string;
    nombreComercial?: string;
    direccion: string;
    latitud?: number;
    longitud?: number;
    telefono?: string;
  };
  horaLimite?: string;
  notas?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}
