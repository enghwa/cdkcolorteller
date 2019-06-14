<template>
  <div id="app">
    <h2>Color Teller</h2>
    <button id="btn" class v-on:click="sendJob()">Go!</button>
    <br>
    <svg height="100" width="100">
      <circle cx="50" cy="50" r="40" stroke="black" stroke-width="3" v-bind:fill="color"></circle>
    </svg>
    <p>
      <img
        alt="QR"
        v-bind:src="`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${inputurl}/app/`"
        alight="right"
      >
  
  </div>
</template>

<script>
import axios from "axios";

export default {
  name: "App",
  data() {
    return {
      color: "black",
      inputurl: "http://ALB-DNS"
    };
  },

  methods: {
    sendJob: function() {
      // this.color = "red"
      axios
        .get(this.inputurl+'/color')
        .then(response => (this.color = response.data.color));
    }
  },
  mounted() {},
  components: {
    // HelloWorld
  }
};
</script>

<style>
#app {
  font-family: "Avenir", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  margin-top: 60px;
}
input {
  padding: 0.3rem 1rem;
  border: 1px solid #cccccc;
  outline: none;
  width: 40%;
  font-size: 14px;
  text-align: center;
}
button {
  font-size: 18px;
}
</style>
