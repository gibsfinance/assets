import * as collectGithub from '../collect/github'

collectGithub.collect({}).catch((err) => console.log(err))
