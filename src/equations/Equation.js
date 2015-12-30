module.exports = Equation;

var vec2 = require('../math/vec2'),
    add = vec2.add,
    scale = vec2.scale,
    multiply = vec2.multiply,
    createVec2 = vec2.create,
    Utils = require('../utils/Utils');

/**
 * Base class for constraint equations.
 * @class Equation
 * @constructor
 * @param {Body} bodyA First body participating in the equation
 * @param {Body} bodyB Second body participating in the equation
 * @param {number} minForce Minimum force to apply. Default: -Number.MAX_VALUE
 * @param {number} maxForce Maximum force to apply. Default: Number.MAX_VALUE
 */
function Equation(bodyA, bodyB, minForce, maxForce){

    /**
     * Minimum force to apply when solving.
     * @property minForce
     * @type {Number}
     */
    this.minForce = typeof(minForce)==="undefined" ? -Number.MAX_VALUE : minForce;

    /**
     * Max force to apply when solving.
     * @property maxForce
     * @type {Number}
     */
    this.maxForce = typeof(maxForce)==="undefined" ? Number.MAX_VALUE : maxForce;

    /**
     * First body participating in the constraint
     * @property bodyA
     * @type {Body}
     */
    this.bodyA = bodyA;

    /**
     * Second body participating in the constraint
     * @property bodyB
     * @type {Body}
     */
    this.bodyB = bodyB;

    /**
     * The stiffness of this equation. Typically chosen to a large number (~1e7), but can be chosen somewhat freely to get a stable simulation.
     * @property stiffness
     * @type {Number}
     */
    this.stiffness = Equation.DEFAULT_STIFFNESS;

    /**
     * The number of time steps needed to stabilize the constraint equation. Typically between 3 and 5 time steps.
     * @property relaxation
     * @type {Number}
     */
    this.relaxation = Equation.DEFAULT_RELAXATION;

    /**
     * The Jacobian entry of this equation. 6 numbers, 3 per body (x,y,angle).
     * @property G
     * @type {Array}
     */
    this.G = new Utils.ARRAY_TYPE(6);
    for(var i=0; i<6; i++){
        this.G[i]=0;
    }

    this.offset = 0;

    this.a = 0;
    this.b = 0;
    this.epsilon = 0;
    this.timeStep = 1/60;

    /**
     * Indicates if stiffness or relaxation was changed.
     * @property {Boolean} needsUpdate
     */
    this.needsUpdate = true;

    /**
     * The resulting constraint multiplier from the last solve. This is mostly equivalent to the force produced by the constraint.
     * @property multiplier
     * @type {Number}
     */
    this.multiplier = 0;

    /**
     * Relative velocity.
     * @property {Number} relativeVelocity
     */
    this.relativeVelocity = 0;

    /**
     * Whether this equation is enabled or not. If true, it will be added to the solver.
     * @property {Boolean} enabled
     */
    this.enabled = true;

    this.lambda = this.B = this.invC = 0;
}

/**
 * The default stiffness when creating a new Equation.
 * @static
 * @property {Number} DEFAULT_STIFFNESS
 * @default 1e6
 */
Equation.DEFAULT_STIFFNESS = 1e6;

/**
 * The default relaxation when creating a new Equation.
 * @static
 * @property {Number} DEFAULT_RELAXATION
 * @default 4
 */
Equation.DEFAULT_RELAXATION = 4;

var addToWlambda_temp = createVec2(),
    addToWlambda_Gi = createVec2(),
    addToWlambda_Gj = createVec2(),
    qi = createVec2(),
    qj = createVec2(),
    iMfi = createVec2(),
    iMfj = createVec2();

Equation.prototype = {

    /**
     * Compute SPOOK parameters .a, .b and .epsilon according to the current parameters. See equations 9, 10 and 11 in the <a href="http://www8.cs.umu.se/kurser/5DV058/VT09/lectures/spooknotes.pdf">SPOOK notes</a>.
     * @method update
     */
    update: function(){
        var k = this.stiffness,
            d = this.relaxation,
            h = this.timeStep;

        this.a = 4.0 / (h * (1 + 4 * d));
        this.b = (4.0 * d) / (1 + 4 * d);
        this.epsilon = 4.0 / (h * h * k * (1 + 4 * d));

        this.needsUpdate = false;
    },

    /**
     * Multiply a jacobian entry with corresponding positions or velocities
     * @method gmult
     * @return {Number}
     */
    gmult: function(G,vi,wi,vj,wj){
        return  G[0] * vi[0] +
                G[1] * vi[1] +
                G[2] * wi +
                G[3] * vj[0] +
                G[4] * vj[1] +
                G[5] * wj;
    },

    /**
     * Computes the RHS of the SPOOK equation
     * @method computeB
     * @return {Number}
     */
    computeB: function(a,b,h){
        var GW = this.computeGW();
        var Gq = this.computeGq();
        var GiMf = this.computeGiMf();
        var B = - Gq * a - GW * b - GiMf * h;
        return B;
    },

    /**
     * Computes G\*q, where q are the generalized body coordinates
     * @method computeGq
     * @return {Number}
     */
    computeGq: function(){
        var G = this.G,
            bi = this.bodyA,
            bj = this.bodyB,
            ai = bi.angle,
            aj = bj.angle;

        return this.gmult(G, qi, ai, qj, aj) + this.offset;
    },

    /**
     * Computes G\*W, where W are the body velocities
     * @method computeGW
     * @return {Number}
     */
    computeGW: function(){
        var G = this.G,
            bi = this.bodyA,
            bj = this.bodyB,
            vi = bi.velocity,
            vj = bj.velocity,
            wi = bi.angularVelocity,
            wj = bj.angularVelocity;
        return this.gmult(G,vi,wi,vj,wj) + this.relativeVelocity;
    },

    /**
     * Computes G\*Wlambda, where W are the body velocities
     * @method computeGWlambda
     * @return {Number}
     */
    computeGWlambda: function(){
        var G = this.G,
            bi = this.bodyA,
            bj = this.bodyB,
            vi = bi.vlambda,
            vj = bj.vlambda,
            wi = bi.wlambda,
            wj = bj.wlambda;
        return this.gmult(G,vi,wi,vj,wj);
    },

    /**
     * Computes G\*inv(M)\*f, where M is the mass matrix with diagonal blocks for each body, and f are the forces on the bodies.
     * @method computeGiMf
     * @return {Number}
     */
    computeGiMf: function(){
        var bi = this.bodyA,
            bj = this.bodyB,
            fi = bi.force,
            ti = bi.angularForce,
            fj = bj.force,
            tj = bj.angularForce,
            invMassi = bi.invMassSolve,
            invMassj = bj.invMassSolve,
            invIi = bi.invInertiaSolve,
            invIj = bj.invInertiaSolve,
            G = this.G;

        scale(iMfi, fi, invMassi);
        multiply(iMfi, bi.massMultiplier, iMfi);
        scale(iMfj, fj,invMassj);
        multiply(iMfj, bj.massMultiplier, iMfj);

        return this.gmult(G,iMfi,ti*invIi,iMfj,tj*invIj);
    },

    /**
     * Computes G\*inv(M)\*G'
     * @method computeGiMGt
     * @return {Number}
     */
    computeGiMGt: function(){
        var bi = this.bodyA,
            bj = this.bodyB,
            invMassi = bi.invMassSolve,
            invMassj = bj.invMassSolve,
            invIi = bi.invInertiaSolve,
            invIj = bj.invInertiaSolve,
            G = this.G;

        return  G[0] * G[0] * invMassi * bi.massMultiplier[0] +
                G[1] * G[1] * invMassi * bi.massMultiplier[1] +
                G[2] * G[2] *    invIi +
                G[3] * G[3] * invMassj * bj.massMultiplier[0] +
                G[4] * G[4] * invMassj * bj.massMultiplier[1] +
                G[5] * G[5] *    invIj;
    },

    /**
     * Add constraint velocity to the bodies.
     * @method addToWlambda
     * @param {Number} deltalambda
     */
    addToWlambda: function(deltalambda){
        var bi = this.bodyA,
            bj = this.bodyB,
            temp = addToWlambda_temp,
            Gi = addToWlambda_Gi,
            Gj = addToWlambda_Gj,
            invMassi = bi.invMassSolve,
            invMassj = bj.invMassSolve,
            invIi = bi.invInertiaSolve,
            invIj = bj.invInertiaSolve,
            G = this.G;

        Gi[0] = G[0];
        Gi[1] = G[1];
        Gj[0] = G[3];
        Gj[1] = G[4];

        // Add to linear velocity
        scale(temp, Gi, invMassi*deltalambda);
        multiply(temp, temp, bi.massMultiplier);
        add( bi.vlambda, bi.vlambda, temp);
        // This impulse is in the offset frame
        // Also add contribution to angular
        bi.wlambda += invIi * G[2] * deltalambda;

        scale(temp, Gj, invMassj*deltalambda);
        multiply(temp, temp, bj.massMultiplier);
        add( bj.vlambda, bj.vlambda, temp);
        bj.wlambda += invIj * G[5] * deltalambda;
    },

    /**
     * Compute the denominator part of the SPOOK equation: C = G\*inv(M)\*G' + eps
     * @method computeInvC
     * @param  {Number} eps
     * @return {Number}
     */
    computeInvC: function(eps){
        var invC = 1 / (this.computeGiMGt() + eps);
        return invC;
    }
};