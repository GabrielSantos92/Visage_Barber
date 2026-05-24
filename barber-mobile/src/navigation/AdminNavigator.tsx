import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Feather } from '@expo/vector-icons';
import AdminHomeScreen from '../screens/admin/AdminHomeScreen';
import UsuariosScreen from '../screens/admin/UsuariosScreen';
import BarbeariasScreen from '../screens/admin/BarbeariasScreen';
import { useTheme } from '../contexts/ThemeContext';
import { F } from '../lib/theme';

export type AdminTabParamList = {
  AdminHome: undefined;
  Usuarios: undefined;
  Barbearias: undefined;
};

const Tab = createBottomTabNavigator<AdminTabParamList>();

const TAB_ICONS: Record<string, any> = {
  AdminHome:  'bar-chart-2',
  Usuarios:   'users',
  Barbearias: 'scissors',
};

const TAB_LABELS: Record<string, string> = {
  AdminHome:  'DASHBOARD',
  Usuarios:   'USUÁRIOS',
  Barbearias: 'BARBEIROS',
};

export default function AdminNavigator() {
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
      <Tab.Screen name="AdminHome" component={AdminHomeScreen} />
      <Tab.Screen name="Usuarios" component={UsuariosScreen} />
      <Tab.Screen name="Barbearias" component={BarbeariasScreen} />
    </Tab.Navigator>
  );
}
