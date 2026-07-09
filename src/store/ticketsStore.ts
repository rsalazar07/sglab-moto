import { create } from 'zustand';
import type { Ticket } from '../types';

interface TicketsState {
  tickets: Ticket[];
  setTickets: (tickets: Ticket[]) => void;
  addTicket: (ticket: Ticket) => void;
  updateTicket: (ticketId: string, estado: string) => void;
  removeTicket: (ticketId: string) => void;
  triggerRefresh: number;
  requestRefresh: () => void;
}

export const useTicketsStore = create<TicketsState>((set) => ({
  tickets: [],
  setTickets: (tickets) => set({ tickets }),
  addTicket: (ticket) =>
    set((state) => {
      if (state.tickets.some((t) => t.id === ticket.id)) return state;
      return { tickets: [ticket, ...state.tickets] };
    }),
  updateTicket: (ticketId, estado) =>
    set((state) => ({
      tickets: state.tickets.map((t) =>
        t.id === ticketId ? { ...t, estado: estado as any } : t
      ),
    })),
  removeTicket: (ticketId) =>
    set((state) => ({
      tickets: state.tickets.filter((t) => t.id !== ticketId),
    })),
  triggerRefresh: 0,
  requestRefresh: () => set((state) => ({ triggerRefresh: state.triggerRefresh + 1 })),
}));
