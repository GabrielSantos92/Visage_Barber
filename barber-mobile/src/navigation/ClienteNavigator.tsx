import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Feather } from '@expo/vector-icons';
import HomeScreen from '../screens/cliente/HomeScreen';
import BookingScreen from '../screens/cliente/BookingScreen';
import AgendamentosScreen from '../screens/cliente/AgendamentosScreen';
import AvaliacaoScreen from '../screens/cliente/AvaliacaoScreen';
import VisagismoScreen from '../screens/cliente/VisagismoScreen';
import RecomendacaoScreen from '../screens/cliente/RecomendacaoScreen';
import PerfilScreen from '../screens/cliente/PerfilScreen';
import VisagismoFotoScreen from '../screens/cliente/VisagismoFotoScreen';
import VisagismoResultadoScreen from '../screens/cliente/VisagismoResultadoScreen';
import ChatScreen from '../screens/chat/ChatScreen';
import { useTheme } from '../contexts/ThemeContext';
import { F } from '../lib/theme';

export type ClienteTabParamList = {
  Inicio: undefined;
  Agendar: { initialBarbeiroId?: string } | undefined;
  MeusAgendamentos: undefined;
  Visagismo: undefined;
  Perfil: undefined;
};

export type ClienteStackParamList = {
  ClienteTabs: undefined;
  Avaliacao: { agendamentoId: string; barbeiroId: string };
  Recomendacao: { formato: string };
  VisagismoFoto: undefined;
  VisagismoResultado: { resultado: any };
  Chat: { outroNome: string; barbeiroId: string; clienteId: string };
};

const Tab = createBottomTabNavigator<ClienteTabParamList>();
const Stack = createStackNavigator<ClienteStackParamList>();

const TAB_ICONS: Record<string, any> = {
  Inicio: 'home',
  Agendar: 'calendar',
  MeusAgendamentos: 'list',
  Visagismo: 'scissors',
  Perfil: 'user',
};

const TAB_LABELS: Record<string, string> = {
  Inicio: 'INÍCIO',
  Agendar: 'AGENDAR',
  MeusAgendamentos: 'AGENDA',
  Visagismo: 'ROSTO',
  Perfil: 'PERFIL',
};

function ClienteTabs() {
  const { C } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused }) => (
          <Feather name={TAB_ICONS[route.name]} size={18} color={focused ? C.primary : C.mutedFg} />
        ),
        tabBarLabel: TAB_LABELS[route.name] ?? route.name,
        tabBarActiveTintColor: C.primary,
        tabBarInactiveTintColor: C.mutedFg,
        tabBarStyle: {
          backgroundColor: C.card,
          borderTopWidth: 1,
          borderTopColor: C.border,
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontFamily: F.mono,
          fontSize: 8,
          letterSpacing: 1,
        },
        headerShown: false,
      })}
    >
      <Tab.Screen name="Inicio" component={HomeScreen} />
      <Tab.Screen name="Agendar" component={BookingScreen} />
      <Tab.Screen name="MeusAgendamentos" component={AgendamentosScreen} />
      <Tab.Screen name="Visagismo" component={VisagismoScreen} />
      <Tab.Screen name="Perfil" component={PerfilScreen} />
    </Tab.Navigator>
  );
}

export default function ClienteNavigator() {
  const { C } = useTheme();
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ClienteTabs" component={ClienteTabs} />
      <Stack.Screen
        name="Avaliacao"
        component={AvaliacaoScreen}
        options={{
          headerShown: true,
          title: 'AVALIAR SERVIÇO',
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.primary,
          headerTitleStyle: { fontFamily: F.mono, fontSize: 11, letterSpacing: 2 },
          headerShadowVisible: false,
          headerBackTitle: '',
        }}
      />
      <Stack.Screen
        name="Recomendacao"
        component={RecomendacaoScreen}
        options={{
          headerShown: true,
          title: 'RECOMENDAÇÃO',
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.primary,
          headerTitleStyle: { fontFamily: F.mono, fontSize: 11, letterSpacing: 2 },
          headerShadowVisible: false,
          headerBackTitle: '',
        }}
      />
      <Stack.Screen
        name="VisagismoFoto"
        component={VisagismoFotoScreen}
        options={{
          headerShown: true,
          title: 'VISAGISMO IA',
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.primary,
          headerTitleStyle: { fontFamily: F.mono, fontSize: 11, letterSpacing: 2 },
          headerShadowVisible: false,
          headerBackTitle: '',
        }}
      />
      <Stack.Screen
        name="VisagismoResultado"
        component={VisagismoResultadoScreen}
        options={{
          headerShown: true,
          title: 'RESULTADO',
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.primary,
          headerTitleStyle: { fontFamily: F.mono, fontSize: 11, letterSpacing: 2 },
          headerShadowVisible: false,
          headerBackTitle: '',
        }}
      />
      <Stack.Screen
        name="Chat"
        component={ChatScreen}
        options={({ route }) => ({
          headerShown: true,
          title: route.params.outroNome.toUpperCase(),
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.primary,
          headerTitleStyle: { fontFamily: F.mono, fontSize: 11, letterSpacing: 2 },
          headerShadowVisible: false,
          headerBackTitle: '',
        })}
      />
    </Stack.Navigator>
  );
}
