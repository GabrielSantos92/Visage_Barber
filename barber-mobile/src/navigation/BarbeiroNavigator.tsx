import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Feather } from '@expo/vector-icons';
import BarbeiroHomeScreen from '../screens/barbeiro/BarbeiroHomeScreen';
import AgendaScreen from '../screens/barbeiro/AgendaScreen';
import ServicosScreen from '../screens/barbeiro/ServicosScreen';
import BarbeiroPerfilScreen from '../screens/barbeiro/BarbeiroPerfilScreen';
import ChatScreen from '../screens/chat/ChatScreen';
import { usePushToken } from '../hooks/usePushToken';
import { useTheme } from '../contexts/ThemeContext';
import { F } from '../lib/theme';

export type BarbeiroTabParamList = {
  BarbeiroHome: undefined;
  Agenda: undefined;
  Servicos: undefined;
  BarbeiroPerfil: undefined;
};

export type BarbeiroStackParamList = {
  BarbeiroTabs: undefined;
  Chat: { outroNome: string; barbeiroId: string; clienteId: string };
};

const Tab = createBottomTabNavigator<BarbeiroTabParamList>();
const Stack = createStackNavigator<BarbeiroStackParamList>();

const TAB_ICONS: Record<string, any> = {
  BarbeiroHome:   'calendar',
  Agenda:         'clock',
  Servicos:       'scissors',
  BarbeiroPerfil: 'user',
};

const TAB_LABELS: Record<string, string> = {
  BarbeiroHome:   'AGENDA',
  Agenda:         'HORÁRIOS',
  Servicos:       'SERVIÇOS',
  BarbeiroPerfil: 'PERFIL',
};

function BarbeiroTabs() {
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
      <Tab.Screen name="BarbeiroHome" component={BarbeiroHomeScreen} />
      <Tab.Screen name="Agenda" component={AgendaScreen} />
      <Tab.Screen name="Servicos" component={ServicosScreen} />
      <Tab.Screen name="BarbeiroPerfil" component={BarbeiroPerfilScreen} />
    </Tab.Navigator>
  );
}

export default function BarbeiroNavigator() {
  const { C } = useTheme();
  usePushToken('barbeiro');
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="BarbeiroTabs" component={BarbeiroTabs} />
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
