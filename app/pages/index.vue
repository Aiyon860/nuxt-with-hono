<script setup lang="ts">
const { data, error } = await useFetch<{ user: string }>('/api/auth/me')
if (error.value) await navigateTo('/login')
</script>

<template><main>Halo, {{ data?.user }}</main></template>
