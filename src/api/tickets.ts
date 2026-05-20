import { api } from './client';
import type { Ticket, EstadoTicket } from '../types';

export const ticketsApi = {
  getMisTickets: async (): Promise<Ticket[]> => {
    const { data } = await api.get('/tickets');
    if (Array.isArray(data)) return data;
    if (data.data) return data.data;
    return [];
  },

  updateEstado: async (ticketId: string, estado: EstadoTicket, notas?: string): Promise<Ticket> => {
    const { data } = await api.post<Ticket>(`/tickets/${ticketId}/cambiar-estado`, { estado, notas });
    return data;
  },

  tomarTicket: async (ticketId: string): Promise<Ticket> => {
    const { data } = await api.post<Ticket>(`/tickets/${ticketId}/tomar`);
    return data;
  },
};
