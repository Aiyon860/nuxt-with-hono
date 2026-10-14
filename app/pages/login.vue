<script setup lang="ts">
const username = ref('')
const password = ref('')
const err = ref('')
async function submit() {
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: { username: username.value, password: password.value } })
    await navigateTo('/')
  } catch {
    err.value = 'Login gagal'
  }
}
</script>

<template>
  <form @submit.prevent="submit">
    <input v-model="username" placeholder="Username" autocomplete="username" />
    <input v-model="password" type="password" placeholder="Password" autocomplete="current-password" />
    <button>Masuk</button>
    <p v-if="err">{{ err }}</p>
  </form>
</template>
