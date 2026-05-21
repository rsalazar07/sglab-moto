import { api } from './client';
import type { Ticket, EstadoTicket } from '../types';

export const ticketsApi = {

  getMisTickets: async (): Promise<Ticket[]> => {
    const { data } = await api.get('/tickets');
    if (Array.isArray(data)) return data;
    if (data.data) return data.data;
    return [];
  },

  updateEstado: async (ticketId: string, estado: EstadoTicket): Promise<Ticket> => {
    const { data } = await api.post<Ticket>(`/tickets/${ticketId}/cambiar-estado`, { estado });
    return data;
  },

  tomarTicket: async (ticketId: string): Promise<Ticket> => {
    const { data } = await api.post<Ticket>(`/tickets/${ticketId}/tomar`);
    return data;
  },

  subirEvidencia: async (ticketId: string, fotoUri: string): Promise<{ url: string }> => {
    const formData = new FormData();
    formData.append('foto', {
      uri: fotoUri,
      name: `evidencia_${ticketId}_${Date.now()}.jpg`,
      type: 'image/jpeg',
    } as any);
    const { data } = await api.post<{ url: string }>(
      `/tickets/${ticketId}/evidencia`,
      formData
    );
    return data;
  },

  registrarCobro: async (
    ticketId: string,
    cobro: { metodo: string; monto: number }
  ): Promise<any> => {
    const { data } = await api.post(`/tickets/${ticketId}/cobro`, cobro);
    return data;
  },

  guardarRegistro: async (
    ticketId: string,
    registro: { refNombre?: string; observaciones?: string; fotoUrl?: string; fotoBase64?: string; sinInfo?: boolean }
  ): Promise<any> => {
    const { data } = await api.post(`/tickets/${ticketId}/registro`, registro);
    return data;
  },
};