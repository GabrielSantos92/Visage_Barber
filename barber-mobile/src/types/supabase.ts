export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      agendamentos: {
        Row: {
          barbeiro_id: string
          ativo_final_min: number | null
          ativo_inicial_min: number | null
          cliente_id: string
          created_at: string
          data_hora: string
          duracao_min: number | null
          id: string
          margem_min: number | null
          observacoes: string | null
          pausa_min: number | null
          servico_id: string
          status: Database["public"]["Enums"]["agendamento_status"]
          updated_at: string
        }
        Insert: {
          barbeiro_id: string
          ativo_final_min?: number | null
          ativo_inicial_min?: number | null
          cliente_id: string
          created_at?: string
          data_hora: string
          duracao_min?: number | null
          id?: string
          margem_min?: number | null
          observacoes?: string | null
          pausa_min?: number | null
          servico_id: string
          status?: Database["public"]["Enums"]["agendamento_status"]
          updated_at?: string
        }
        Update: {
          barbeiro_id?: string
          ativo_final_min?: number | null
          ativo_inicial_min?: number | null
          cliente_id?: string
          created_at?: string
          data_hora?: string
          duracao_min?: number | null
          id?: string
          margem_min?: number | null
          observacoes?: string | null
          pausa_min?: number | null
          servico_id?: string
          status?: Database["public"]["Enums"]["agendamento_status"]
          updated_at?: string
        }
        Relationships: []
      }
      avaliacoes: {
        Row: {
          agendamento_id: string
          barbeiro_id: string
          cliente_id: string
          comentario: string | null
          created_at: string
          id: string
          nota: number
        }
        Insert: {
          agendamento_id: string
          barbeiro_id: string
          cliente_id: string
          comentario?: string | null
          created_at?: string
          id?: string
          nota: number
        }
        Update: {
          agendamento_id?: string
          barbeiro_id?: string
          cliente_id?: string
          comentario?: string | null
          created_at?: string
          id?: string
          nota?: number
        }
        Relationships: []
      }
      barbeiro_servicos: {
        Row: {
          barbeiro_id: string
          id: string
          servico_id: string
        }
        Insert: {
          barbeiro_id: string
          id?: string
          servico_id: string
        }
        Update: {
          barbeiro_id?: string
          id?: string
          servico_id?: string
        }
        Relationships: []
      }
      barbeiros: {
        Row: {
          ativo: boolean
          created_at: string
          especialidade: string | null
          foto_url: string | null
          id: string
          nome: string
          user_id: string | null
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          especialidade?: string | null
          foto_url?: string | null
          id?: string
          nome: string
          user_id?: string | null
        }
        Update: {
          ativo?: boolean
          created_at?: string
          especialidade?: string | null
          foto_url?: string | null
          id?: string
          nome?: string
          user_id?: string | null
        }
        Relationships: []
      }
      horarios_disponiveis: {
        Row: {
          barbeiro_id: string
          dia_semana: number
          hora_fim: string
          hora_inicio: string
          id: string
        }
        Insert: {
          barbeiro_id: string
          dia_semana: number
          hora_fim: string
          hora_inicio: string
          id?: string
        }
        Update: {
          barbeiro_id?: string
          dia_semana?: number
          hora_fim?: string
          hora_inicio?: string
          id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          formato_rosto: string | null
          id: string
          nome: string
          telefone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          formato_rosto?: string | null
          id?: string
          nome?: string
          telefone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          formato_rosto?: string | null
          id?: string
          nome?: string
          telefone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      servicos: {
        Row: {
          ativo: boolean
          com_pausa: boolean
          ativo_final_min: number | null
          ativo_inicial_min: number | null
          created_at: string
          descricao: string | null
          duracao_min: number
          id: string
          margem_min: number
          nome: string
          pausa_min: number | null
          preco: number
        }
        Insert: {
          ativo?: boolean
          com_pausa?: boolean
          ativo_final_min?: number | null
          ativo_inicial_min?: number | null
          created_at?: string
          descricao?: string | null
          duracao_min?: number
          id?: string
          margem_min?: number
          nome: string
          pausa_min?: number | null
          preco: number
        }
        Update: {
          ativo?: boolean
          com_pausa?: boolean
          ativo_final_min?: number | null
          ativo_inicial_min?: number | null
          created_at?: string
          descricao?: string | null
          duracao_min?: number
          id?: string
          margem_min?: number
          nome?: string
          pausa_min?: number | null
          preco?: number
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      concluir_agendamentos_passados: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      configurar_etapas_servico: {
        Args: {
          p_ativo_final?: number | null
          p_ativo_inicial?: number | null
          p_com_pausa: boolean
          p_margem?: number | null
          p_pausa?: number | null
          p_servico_id: string
        }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      horarios_livres: {
        Args: { p_barbeiro_id: string; p_data: string; p_servico_id: string }
        Returns: { horario: string }[]
      }
      notas_barbeiros: {
        Args: Record<PropertyKey, never>
        Returns: { barbeiro_id: string; media: number; total: number }[]
      }
    }
    Enums: {
      agendamento_status: "confirmado" | "cancelado" | "concluido"
      app_role: "cliente" | "barbeiro" | "admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"]

export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"]

export type Enums<T extends keyof Database["public"]["Enums"]> =
  Database["public"]["Enums"][T]
